package control

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"h2o-agent/hy2update"
)

type Config struct {
	H2OURL               string
	AuthPath             string
	AgentSecret          string
	HysteriaConfigPath   string
	HysteriaServiceName  string
	AgentConfigPath      string
	AutoUpdateEnabled    bool
	Hy2AutoUpdateEnabled bool
	IntervalSeconds      int
	HysteriaStatsURL     string
	HysteriaStatsSecret  string
}

type TaskResult struct {
	ID           int64       `json:"id"`
	Status       string      `json:"status"`
	Result       interface{} `json:"result,omitempty"`
	Error        string      `json:"error,omitempty"`
	RestartAgent bool        `json:"-"`
}

type SyncRequest struct {
	AgentVersion          string       `json:"agent_version"`
	Hostname              string       `json:"hostname,omitempty"`
	OS                    string       `json:"os"`
	Arch                  string       `json:"arch"`
	ServiceManager        string       `json:"service_manager,omitempty"`
	AutoUpdateEnabled     bool         `json:"auto_update_enabled"`
	Hy2AutoUpdateEnabled  bool         `json:"hy2_auto_update_enabled"`
	IntervalSeconds       int          `json:"interval_seconds,omitempty"`
	Hy2Status             string       `json:"hy2_status,omitempty"`
	Hy2Version            string       `json:"hy2_version,omitempty"`
	HysteriaConfigPath    string       `json:"hysteria_config_path,omitempty"`
	HysteriaConfigHash    string       `json:"hysteria_config_hash,omitempty"`
	AppliedConfigRevision int          `json:"applied_config_revision,omitempty"`
	CurrentConfigRevision int          `json:"current_config_revision,omitempty"`
	LastConfigApplyAt     string       `json:"last_config_apply_at,omitempty"`
	LastError             string       `json:"last_error,omitempty"`
	Capabilities          []string     `json:"capabilities"`
	PublicIP              string       `json:"public_ip,omitempty"`
	TaskResults           []TaskResult `json:"task_results,omitempty"`
}

type SyncResponse struct {
	OK   bool `json:"ok"`
	Data struct {
		ServerTime    string `json:"server_time"`
		ControlEnable bool   `json:"control_enabled"`
		DesiredConfig struct {
			Revision    int    `json:"revision"`
			Hash        string `json:"hash"`
			NeedsApply  bool   `json:"needs_apply"`
			ConfigPath  string `json:"config_path"`
			ServiceName string `json:"service_name"`
		} `json:"desired_config"`
		AgentConfig struct {
			IntervalSeconds      int    `json:"interval_seconds"`
			AutoUpdateEnabled    bool   `json:"auto_update_enabled"`
			Hy2AutoUpdateEnabled *bool  `json:"hy2_auto_update_enabled,omitempty"`
			HysteriaStatsURL     string `json:"hysteria_stats_url"`
			HysteriaStatsSecret  string `json:"hysteria_stats_secret"`
		} `json:"agent_config"`
		Tasks []Task `json:"tasks"`
	} `json:"data"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type Task struct {
	ID           int64           `json:"id"`
	Type         string          `json:"type"`
	Payload      json.RawMessage `json:"payload"`
	LeaseSeconds int             `json:"lease_seconds"`
}

type logPayload struct {
	Lines int `json:"lines"`
}

type applyConfigPayload struct {
	YAML        string `json:"yaml"`
	Revision    int    `json:"revision"`
	Hash        string `json:"hash"`
	ConfigPath  string `json:"config_path"`
	ServiceName string `json:"service_name"`
}

const publicIPCacheTTL = 6 * time.Hour

var publicIPCache struct {
	mu        sync.Mutex
	value     string
	expiresAt time.Time
}

func cachedPublicIP(ctx context.Context) string {
	publicIPCache.mu.Lock()
	if publicIPCache.value != "" && time.Now().Before(publicIPCache.expiresAt) {
		value := publicIPCache.value
		publicIPCache.mu.Unlock()
		return value
	}
	publicIPCache.mu.Unlock()

	value := detectPublicIP(ctx)
	if value == "" {
		return ""
	}

	publicIPCache.mu.Lock()
	publicIPCache.value = value
	publicIPCache.expiresAt = time.Now().Add(publicIPCacheTTL)
	publicIPCache.mu.Unlock()
	return value
}

func detectPublicIP(ctx context.Context) string {
	endpoints := []string{
		"https://api.ipify.org",
		"https://api64.ipify.org",
		"https://ifconfig.me/ip",
	}

	for _, endpoint := range endpoints {
		value, err := fetchPublicIP(ctx, endpoint)
		if err == nil && value != "" {
			return value
		}
	}
	return ""
}

func fetchPublicIP(ctx context.Context, endpoint string) (string, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "h2o-agent")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("public ip endpoint returned HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 128))
	if err != nil {
		return "", err
	}

	value := normalizePublicIP(string(data))
	if value == "" {
		return "", fmt.Errorf("public ip endpoint returned invalid ip")
	}
	return value, nil
}

func normalizePublicIP(value string) string {
	ip := net.ParseIP(strings.TrimSpace(value))
	if ip == nil {
		return ""
	}
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return ""
	}
	return ip.String()
}

func Sync(
	ctx context.Context,
	cfg Config,
	version string,
	pending []TaskResult,
) (*SyncResponse, []TaskResult, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	deliveredPendingRestart := shouldRestartAgent(pending)

	if cfg.AgentSecret == "" {
		return nil, pending, fmt.Errorf("agent_secret 为空，无法同步控制面")
	}

	status, _ := serviceStatus(requestCtx, cfg.HysteriaServiceName)
	hy2Version, _ := hysteriaVersion(requestCtx)
	hostname, _ := os.Hostname()
	lastError := ""
	if err := ensureExistingConfigReadable(requestCtx, cfg.HysteriaConfigPath, cfg.HysteriaServiceName); err != nil {
		lastError = fmt.Sprintf("修正 Hy2 配置权限失败: %v", err)
	}
	configHash := hashFile(cfg.HysteriaConfigPath)
	publicIP := cachedPublicIP(requestCtx)

	body := SyncRequest{
		AgentVersion:          version,
		Hostname:              hostname,
		OS:                    runtime.GOOS,
		Arch:                  runtime.GOARCH,
		ServiceManager:        detectServiceManager(),
		AutoUpdateEnabled:     cfg.AutoUpdateEnabled,
		Hy2AutoUpdateEnabled:  cfg.Hy2AutoUpdateEnabled,
		IntervalSeconds:       cfg.IntervalSeconds,
		Hy2Status:             status,
		Hy2Version:            hy2Version,
		HysteriaConfigPath:    cfg.HysteriaConfigPath,
		HysteriaConfigHash:    configHash,
		AppliedConfigRevision: readRevision(cfg.HysteriaConfigPath),
		CurrentConfigRevision: readRevision(cfg.HysteriaConfigPath),
		LastConfigApplyAt:     readApplyTime(cfg.HysteriaConfigPath),
		LastError:             lastError,
		Capabilities: []string{
			"status",
			"logs",
			"service-control",
			"apply-config",
			"agent-restart",
			"self-update",
			"hy2-update",
			"public-ip",
		},
		PublicIP:    publicIP,
		TaskResults: pending,
	}

	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, pending, err
	}

	resp, err := postSigned(requestCtx, cfg, encoded)
	if err != nil {
		return nil, pending, err
	}
	if !resp.OK {
		if resp.Error != nil {
			return resp, pending, fmt.Errorf(
				"控制面返回错误: %s %s",
				resp.Error.Code,
				resp.Error.Message,
			)
		}
		return resp, pending, fmt.Errorf("控制面返回错误")
	}

	// 已成功送达面板，清空本地待确认结果；本轮执行的新结果会立即补交一次。
	pending = nil
	results := make([]TaskResult, 0, len(resp.Data.Tasks)+1)
	if err := updateLocalAgentConfig(cfg, resp); err != nil {
		results = append(results, TaskResult{
			Status: "failed",
			Error:  err.Error(),
		})
	} else {
		cfg = withPanelAgentConfig(cfg, resp)
	}

	for _, task := range resp.Data.Tasks {
		// 任务可能包含下载更新等长耗时操作，使用自身 taskTimeout 控制，
		// 不复用控制面请求的短超时。
		results = append(results, ExecuteTask(ctx, cfg, task, version))
	}

	restartAgent := deliveredPendingRestart || shouldRestartAgent(results)
	if deliveredPendingRestart && len(results) > 0 && !shouldRestartAgent(results) {
		// 如果本轮新结果提交失败，保留重启意图到下次成功补交结果后再执行。
		results[0].RestartAgent = true
	}

	if len(results) > 0 {
		if err := submitTaskResults(ctx, cfg, version, results); err != nil {
			return resp, results, err
		}
		results = nil
	}
	if restartAgent {
		if err := restartAgentService(ctx); err != nil {
			return resp, results, fmt.Errorf("更新 Agent 已完成但重启 agent 服务失败: %w", err)
		}
	}

	return resp, results, nil
}

func submitTaskResults(ctx context.Context, cfg Config, version string, results []TaskResult) error {
	requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	status, _ := serviceStatus(requestCtx, cfg.HysteriaServiceName)
	hy2Version, _ := hysteriaVersion(requestCtx)
	hostname, _ := os.Hostname()
	lastError := ""
	if err := ensureExistingConfigReadable(requestCtx, cfg.HysteriaConfigPath, cfg.HysteriaServiceName); err != nil {
		lastError = fmt.Sprintf("修正 Hy2 配置权限失败: %v", err)
	}
	publicIP := cachedPublicIP(requestCtx)

	body := SyncRequest{
		AgentVersion:          version,
		Hostname:              hostname,
		OS:                    runtime.GOOS,
		Arch:                  runtime.GOARCH,
		ServiceManager:        detectServiceManager(),
		AutoUpdateEnabled:     cfg.AutoUpdateEnabled,
		Hy2AutoUpdateEnabled:  cfg.Hy2AutoUpdateEnabled,
		IntervalSeconds:       cfg.IntervalSeconds,
		Hy2Status:             status,
		Hy2Version:            hy2Version,
		HysteriaConfigPath:    cfg.HysteriaConfigPath,
		HysteriaConfigHash:    hashFile(cfg.HysteriaConfigPath),
		AppliedConfigRevision: readRevision(cfg.HysteriaConfigPath),
		CurrentConfigRevision: readRevision(cfg.HysteriaConfigPath),
		LastConfigApplyAt:     readApplyTime(cfg.HysteriaConfigPath),
		LastError:             lastError,
		Capabilities: []string{
			"status",
			"logs",
			"service-control",
			"apply-config",
			"agent-restart",
			"self-update",
			"hy2-update",
			"public-ip",
		},
		PublicIP:    publicIP,
		TaskResults: results,
	}

	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	resp, err := postSigned(requestCtx, cfg, encoded)
	if err != nil {
		return err
	}
	if !resp.OK {
		if resp.Error != nil {
			return fmt.Errorf("控制面返回错误: %s %s", resp.Error.Code, resp.Error.Message)
		}
		return fmt.Errorf("控制面返回错误")
	}
	return nil
}

func withPanelAgentConfig(cfg Config, resp *SyncResponse) Config {
	if resp.Data.AgentConfig.IntervalSeconds > 0 {
		cfg.IntervalSeconds = resp.Data.AgentConfig.IntervalSeconds
	}
	cfg.AutoUpdateEnabled = resp.Data.AgentConfig.AutoUpdateEnabled
	if resp.Data.AgentConfig.Hy2AutoUpdateEnabled != nil {
		cfg.Hy2AutoUpdateEnabled = *resp.Data.AgentConfig.Hy2AutoUpdateEnabled
	}
	if resp.Data.AgentConfig.HysteriaStatsURL != "" {
		cfg.HysteriaStatsURL = resp.Data.AgentConfig.HysteriaStatsURL
	}
	if resp.Data.AgentConfig.HysteriaStatsSecret != "" {
		cfg.HysteriaStatsSecret = resp.Data.AgentConfig.HysteriaStatsSecret
	}
	return cfg
}

func updateLocalAgentConfig(cfg Config, resp *SyncResponse) error {
	if cfg.AgentConfigPath == "" {
		return nil
	}
	data, err := os.ReadFile(cfg.AgentConfigPath)
	if err != nil {
		return nil
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	changed := false
	if resp.Data.AgentConfig.IntervalSeconds > 0 &&
		resp.Data.AgentConfig.IntervalSeconds != cfg.IntervalSeconds {
		raw["interval_seconds"] = resp.Data.AgentConfig.IntervalSeconds
		changed = true
	}
	if resp.Data.AgentConfig.AutoUpdateEnabled != cfg.AutoUpdateEnabled {
		raw["auto_update_enabled"] = resp.Data.AgentConfig.AutoUpdateEnabled
		changed = true
	}
	if resp.Data.AgentConfig.Hy2AutoUpdateEnabled != nil &&
		*resp.Data.AgentConfig.Hy2AutoUpdateEnabled != cfg.Hy2AutoUpdateEnabled {
		raw["hy2_auto_update_enabled"] = *resp.Data.AgentConfig.Hy2AutoUpdateEnabled
		changed = true
	}
	if resp.Data.AgentConfig.HysteriaStatsURL != "" &&
		resp.Data.AgentConfig.HysteriaStatsURL != cfg.HysteriaStatsURL {
		raw["hysteria_stats_url"] = resp.Data.AgentConfig.HysteriaStatsURL
		changed = true
	}
	if resp.Data.AgentConfig.HysteriaStatsSecret != "" &&
		resp.Data.AgentConfig.HysteriaStatsSecret != cfg.HysteriaStatsSecret {
		raw["hysteria_stats_secret"] = resp.Data.AgentConfig.HysteriaStatsSecret
		changed = true
	}
	if !changed {
		return nil
	}
	encoded, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(cfg.AgentConfigPath, append(encoded, '\n'), 0600)
}

func postSigned(ctx context.Context, cfg Config, body []byte) (*SyncResponse, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	target := fmt.Sprintf(
		"%s/api/node/agent/%s/sync",
		strings.TrimRight(cfg.H2OURL, "/"),
		url.PathEscape(cfg.AuthPath),
	)

	req, err := http.NewRequestWithContext(
		requestCtx,
		http.MethodPost,
		target,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	u, err := url.Parse(target)
	if err != nil {
		return nil, err
	}
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	nonce := randomNonce()
	signature := signRequest(cfg.AgentSecret, timestamp, nonce, http.MethodPost, u.Path, body)
	req.Header.Set("X-H2O-Agent-Timestamp", timestamp)
	req.Header.Set("X-H2O-Agent-Nonce", nonce)
	req.Header.Set("X-H2O-Agent-Signature", signature)

	httpResp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer httpResp.Body.Close()

	data, _ := io.ReadAll(httpResp.Body)
	var out SyncResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf(
			"解析控制面响应失败 HTTP %d: %w: %s",
			httpResp.StatusCode,
			err,
			string(data),
		)
	}
	if httpResp.StatusCode/100 != 2 {
		if out.Error != nil {
			return &out, fmt.Errorf(
				"HTTP %d: %s %s",
				httpResp.StatusCode,
				out.Error.Code,
				out.Error.Message,
			)
		}
		return &out, fmt.Errorf("HTTP %d: %s", httpResp.StatusCode, string(data))
	}
	return &out, nil
}

func signRequest(secret, timestamp, nonce, method, path string, body []byte) string {
	bodyHash := sha256.Sum256(body)
	message := strings.Join([]string{
		timestamp,
		nonce,
		strings.ToUpper(method),
		path,
		hex.EncodeToString(bodyHash[:]),
	}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

func randomNonce() string {
	buf := make([]byte, 18)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func ExecuteTask(ctx context.Context, cfg Config, task Task, version string) TaskResult {
	taskCtx, cancel := context.WithTimeout(ctx, taskTimeout(task.Type))
	defer cancel()

	switch task.Type {
	case "HY2_STATUS":
		status, err := serviceStatus(taskCtx, cfg.HysteriaServiceName)
		if err != nil {
			return failedTask(task.ID, err)
		}
		return succeededTask(task.ID, map[string]string{"status": status})
	case "HY2_START":
		return runServiceTask(taskCtx, task.ID, "start", cfg.HysteriaServiceName)
	case "HY2_STOP":
		return runServiceTask(taskCtx, task.ID, "stop", cfg.HysteriaServiceName)
	case "HY2_RESTART":
		return runServiceTask(taskCtx, task.ID, "restart", cfg.HysteriaServiceName)
	case "HY2_LOGS":
		return readLogsTask(taskCtx, task.ID, cfg.HysteriaServiceName, task.Payload)
	case "HY2_SELF_UPDATE":
		return hy2SelfUpdateTask(taskCtx, task.ID, cfg.HysteriaServiceName)
	case "AGENT_LOGS":
		return readLogsTask(taskCtx, task.ID, "h2o-agent", task.Payload)
	case "AGENT_RESTART":
		return agentRestartTask(task.ID)
	case "APPLY_CONFIG":
		var payload applyConfigPayload
		if len(task.Payload) > 0 && string(task.Payload) != "null" {
			if err := json.Unmarshal(task.Payload, &payload); err != nil {
				return failedTask(task.ID, err)
			}
		}
		if payload.ConfigPath == "" {
			payload.ConfigPath = cfg.HysteriaConfigPath
		}
		if payload.ServiceName == "" {
			payload.ServiceName = cfg.HysteriaServiceName
		}
		result := applyConfig(taskCtx, cfg, payload)
		result.ID = task.ID
		return result
	case "AGENT_SELF_UPDATE":
		return selfUpdateTask(taskCtx, task.ID, version, cfg.AgentConfigPath)
	default:
		return failedTask(task.ID, fmt.Errorf("不支持的任务类型: %s", task.Type))
	}
}

func taskTimeout(taskType string) time.Duration {
	switch taskType {
	case "HY2_LOGS", "AGENT_LOGS":
		return time.Minute
	case "APPLY_CONFIG":
		return 5 * time.Minute
	case "AGENT_RESTART", "AGENT_SELF_UPDATE", "HY2_SELF_UPDATE":
		return 10 * time.Minute
	default:
		return 2 * time.Minute
	}
}

const configBackupRetention = 3
const hy2AutoUpdateInterval = 24 * time.Hour

type hy2UpdateState struct {
	LastCheckAt string `json:"last_check_at"`
}

func MaybeAutoUpdateHy2(ctx context.Context, cfg Config) (*hy2update.Result, error) {
	if !cfg.Hy2AutoUpdateEnabled {
		return nil, nil
	}
	statePath := hy2UpdateStatePath(cfg.AgentConfigPath)
	if !shouldCheckHy2Update(statePath, time.Now()) {
		return nil, nil
	}
	_ = writeHy2UpdateState(statePath, time.Now())
	currentVersion, _ := hysteriaVersion(ctx)
	return runHy2Update(ctx, currentVersion, cfg.HysteriaServiceName)
}

func hy2SelfUpdateTask(ctx context.Context, id int64, serviceName string) TaskResult {
	currentVersion, _ := hysteriaVersion(ctx)
	result, err := runHy2Update(ctx, currentVersion, serviceName)
	if err != nil {
		return failedTask(id, err)
	}
	payload := map[string]interface{}{
		"current_version":  result.CurrentVersion,
		"latest_version":   result.LatestVersion,
		"updated":          result.Updated,
		"restart_required": result.Updated,
	}
	if result.SkippedReason != "" {
		payload["skipped_reason"] = result.SkippedReason
	}
	return succeededTask(id, payload)
}

func runHy2Update(ctx context.Context, currentVersion, serviceName string) (*hy2update.Result, error) {
	return hy2update.CheckAndUpdate(ctx, currentVersion, func(restartCtx context.Context) error {
		return serviceCommand(restartCtx, "restart", serviceName)
	})
}

func hy2UpdateStatePath(configPath string) string {
	if configPath != "" {
		return filepath.Join(filepath.Dir(configPath), "hy2-update-state.json")
	}
	return "/etc/h2o-agent/hy2-update-state.json"
}

func shouldCheckHy2Update(path string, now time.Time) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return true
	}
	var state hy2UpdateState
	if err := json.Unmarshal(data, &state); err != nil {
		return true
	}
	lastCheckAt, err := time.Parse(time.RFC3339, state.LastCheckAt)
	if err != nil {
		return true
	}
	return now.Sub(lastCheckAt) >= hy2AutoUpdateInterval
}

func writeHy2UpdateState(path string, checkedAt time.Time) error {
	encoded, err := json.MarshalIndent(hy2UpdateState{
		LastCheckAt: checkedAt.UTC().Format(time.RFC3339),
	}, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, append(encoded, '\n'), 0600)
}

func applyConfig(ctx context.Context, cfg Config, payload applyConfigPayload) TaskResult {
	if payload.YAML == "" {
		return TaskResult{Status: "failed", Error: "配置内容为空"}
	}
	path := firstNonEmpty(payload.ConfigPath, cfg.HysteriaConfigPath)
	serviceName := firstNonEmpty(payload.ServiceName, cfg.HysteriaServiceName)

	hash := sha256.Sum256([]byte(payload.YAML))
	configHash := hex.EncodeToString(hash[:])
	if payload.Hash != "" && payload.Hash != configHash {
		return TaskResult{Status: "failed", Error: "配置哈希不匹配"}
	}

	backupPath := fmt.Sprintf("%s.h2o-backup-%d", path, time.Now().Unix())
	backupExists := false
	if _, err := os.Stat(path); err == nil {
		if err := copyFile(path, backupPath, 0600); err != nil {
			return TaskResult{
				Status: "failed",
				Error:  fmt.Sprintf("备份旧配置失败: %v", err),
			}
		}
		backupExists = true
	}

	content := payload.YAML
	if payload.Revision > 0 &&
		!strings.HasPrefix(content, "# h2o-agent-revision:") {
		content = fmt.Sprintf(
			"# h2o-agent-revision: %d\n%s",
			payload.Revision,
			content,
		)
	}
	content = insertApplyTime(content, time.Now().UTC().Format(time.RFC3339))
	if err := writeConfigFileForService(ctx, path, []byte(content), serviceName); err != nil {
		return TaskResult{
			Status: "failed",
			Error:  fmt.Sprintf("写入配置失败: %v", err),
		}
	}

	if err := serviceCommand(ctx, "restart", serviceName); err != nil {
		if backupExists {
			_ = copyFile(backupPath, path, 0600)
			_ = makeConfigReadableByService(ctx, path, serviceName)
			_ = serviceCommand(ctx, "restart", serviceName)
		}
		return TaskResult{
			Status: "failed",
			Error:  fmt.Sprintf("重启 Hy2 失败，已尝试回滚: %v", err),
		}
	}

	status, _ := serviceStatus(ctx, serviceName)
	result := map[string]interface{}{
		"revision": payload.Revision,
		"hash":     firstNonEmpty(payload.Hash, configHash),
		"path":     path,
		"status":   status,
	}
	if err := cleanupConfigBackups(path, configBackupRetention); err != nil {
		result["backup_cleanup_error"] = fmt.Sprintf("清理旧配置备份失败: %v", err)
	}
	return TaskResult{
		Status: "succeeded",
		Result: result,
	}
}

type configBackupFile struct {
	path      string
	name      string
	timestamp int64
}

func cleanupConfigBackups(path string, keep int) error {
	if path == "" || keep < 0 {
		return nil
	}

	dir := filepath.Dir(path)
	prefix := filepath.Base(path) + ".h2o-backup-"
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	backups := make([]configBackupFile, 0)
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		timestamp, err := strconv.ParseInt(strings.TrimPrefix(name, prefix), 10, 64)
		if err != nil {
			continue
		}
		backups = append(backups, configBackupFile{
			path:      filepath.Join(dir, name),
			name:      name,
			timestamp: timestamp,
		})
	}
	if len(backups) <= keep {
		return nil
	}

	sort.Slice(backups, func(i, j int) bool {
		if backups[i].timestamp == backups[j].timestamp {
			return backups[i].name > backups[j].name
		}
		return backups[i].timestamp > backups[j].timestamp
	})

	var firstErr error
	for _, backup := range backups[keep:] {
		if err := os.Remove(backup.path); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func runServiceTask(ctx context.Context, id int64, action, serviceName string) TaskResult {
	if err := serviceCommand(ctx, action, serviceName); err != nil {
		return failedTask(id, err)
	}
	status, _ := serviceStatus(ctx, serviceName)
	return succeededTask(id, map[string]string{"status": status})
}

func readLogsTask(ctx context.Context, id int64, serviceName string, raw json.RawMessage) TaskResult {
	payload := logPayload{Lines: 120}
	if len(raw) > 0 && string(raw) != "null" {
		_ = json.Unmarshal(raw, &payload)
	}
	if payload.Lines <= 0 || payload.Lines > 500 {
		payload.Lines = 120
	}

	logs, err := readServiceLogs(ctx, serviceName, payload.Lines)
	if err != nil {
		return failedTask(id, err)
	}
	return succeededTask(id, map[string]interface{}{
		"logs":  logs,
		"lines": payload.Lines,
	})
}

func agentRestartTask(id int64) TaskResult {
	result := succeededTask(id, map[string]interface{}{
		"restart_required": true,
	})
	result.RestartAgent = true
	return result
}

func selfUpdateTask(ctx context.Context, id int64, version, configPath string) TaskResult {
	args := []string{"-self-update"}
	if configPath != "" {
		args = append(args, "-c", configPath)
	}
	cmd := exec.CommandContext(ctx, os.Args[0], args...)
	out, err := cmd.CombinedOutput()
	result := map[string]interface{}{
		"output":           trimOutput(string(out), 20000),
		"current_version":  version,
		"updated":          false,
		"restart_required": false,
	}
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 2 {
			result["updated"] = true
			result["restart_required"] = true
			taskResult := succeededTask(id, result)
			taskResult.RestartAgent = true
			return taskResult
		}
		return failedTask(
			id,
			fmt.Errorf("自动更新失败: %w: %s", err, trimOutput(string(out), 4000)),
		)
	}
	return succeededTask(id, result)
}

func serviceCommand(ctx context.Context, action, serviceName string) error {
	if serviceName == "" {
		serviceName = "hysteria-server"
	}
	if !safeServiceName(serviceName) {
		return fmt.Errorf("服务名不合法: %s", serviceName)
	}
	if action != "start" && action != "stop" && action != "restart" {
		return fmt.Errorf("不支持的服务操作: %s", action)
	}
	if isHysteriaService(serviceName) && (action == "start" || action == "restart") {
		cleanupHysteriaFirewallChains(ctx)
	}
	manager := detectServiceManager()
	var cmd *exec.Cmd
	switch manager {
	case "systemd":
		cmd = exec.CommandContext(ctx, "systemctl", action, serviceName)
	case "openrc":
		cmd = exec.CommandContext(ctx, "rc-service", serviceName, action)
	default:
		return fmt.Errorf("未检测到支持的服务管理器")
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf(
			"%s %s 失败: %w: %s",
			action,
			serviceName,
			err,
			trimOutput(string(out), 2000),
		)
	}
	return nil
}

func serviceStatus(ctx context.Context, serviceName string) (string, error) {
	if serviceName == "" {
		serviceName = "hysteria-server"
	}
	if !safeServiceName(serviceName) {
		return "unknown", fmt.Errorf("服务名不合法: %s", serviceName)
	}
	manager := detectServiceManager()
	var cmd *exec.Cmd
	switch manager {
	case "systemd":
		cmd = exec.CommandContext(ctx, "systemctl", "is-active", serviceName)
	case "openrc":
		cmd = exec.CommandContext(ctx, "rc-service", serviceName, "status")
	default:
		return "unknown", fmt.Errorf("未检测到支持的服务管理器")
	}
	out, err := cmd.CombinedOutput()
	text := strings.ToLower(string(out))
	trimmed := strings.TrimSpace(text)
	if err != nil {
		if trimmed == "active" ||
			strings.Contains(text, "started") ||
			strings.Contains(text, "running") {
			return "running", nil
		}
		if strings.Contains(text, "inactive") ||
			strings.Contains(text, "stopped") ||
			strings.Contains(text, "not running") {
			return "stopped", nil
		}
		if strings.Contains(text, "failed") || strings.Contains(text, "crashed") {
			return "failed", nil
		}
		return "unknown", err
	}
	if trimmed == "active" ||
		strings.Contains(text, "started") ||
		strings.Contains(text, "running") {
		return "running", nil
	}
	if strings.Contains(text, "inactive") ||
		strings.Contains(text, "stopped") ||
		strings.Contains(text, "not running") {
		return "stopped", nil
	}
	return strings.TrimSpace(string(out)), nil
}

func readServiceLogs(ctx context.Context, serviceName string, lines int) (string, error) {
	if !safeServiceName(serviceName) {
		return "", fmt.Errorf("服务名不合法: %s", serviceName)
	}
	manager := detectServiceManager()
	var cmd *exec.Cmd
	switch manager {
	case "systemd":
		cmd = exec.CommandContext(
			ctx,
			"journalctl",
			"-u",
			serviceName,
			"-n",
			fmt.Sprintf("%d", lines),
			"--no-pager",
		)
	case "openrc":
		path := "/var/log/" + serviceName + ".log"
		cmd = exec.CommandContext(ctx, "tail", "-n", fmt.Sprintf("%d", lines), path)
	default:
		return "", fmt.Errorf("未检测到支持的服务管理器")
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf(
			"读取日志失败: %w: %s",
			err,
			trimOutput(string(out), 2000),
		)
	}
	return trimOutput(string(out), 20000), nil
}

func isHysteriaService(name string) bool {
	return strings.Contains(strings.ToLower(name), "hysteria")
}

func cleanupHysteriaFirewallChains(ctx context.Context) {
	for _, bin := range []string{"iptables", "ip6tables"} {
		cleanupHysteriaFirewallChainsFor(ctx, bin)
	}
}

func cleanupHysteriaFirewallChainsFor(ctx context.Context, bin string) {
	if _, err := exec.LookPath(bin); err != nil {
		return
	}
	out, err := exec.CommandContext(ctx, bin, "-w", "-t", "nat", "-S").Output()
	if err != nil {
		return
	}
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "-A ") || !strings.Contains(line, "HYSTERIA-") {
			continue
		}
		fields := strings.Fields(strings.Replace(line, "-A ", "-D ", 1))
		if len(fields) == 0 {
			continue
		}
		args := append([]string{"-w", "-t", "nat"}, fields...)
		_ = exec.CommandContext(ctx, bin, args...).Run()
	}
	for _, line := range lines {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) != 2 || fields[0] != "-N" || !strings.HasPrefix(fields[1], "HYSTERIA-") {
			continue
		}
		_ = exec.CommandContext(ctx, bin, "-w", "-t", "nat", "-F", fields[1]).Run()
		_ = exec.CommandContext(ctx, bin, "-w", "-t", "nat", "-X", fields[1]).Run()
	}
}

func safeServiceName(name string) bool {
	if name == "" || len(name) > 128 {
		return false
	}
	for _, r := range name {
		if (r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') ||
			r == '-' ||
			r == '_' ||
			r == '.' ||
			r == '@' {
			continue
		}
		return false
	}
	return true
}

func detectServiceManager() string {
	if _, err := os.Stat("/run/systemd/system"); err == nil {
		if _, err := exec.LookPath("systemctl"); err == nil {
			return "systemd"
		}
	}
	if _, err := exec.LookPath("rc-service"); err == nil {
		return "openrc"
	}
	return "unknown"
}

func hysteriaVersion(ctx context.Context) (string, error) {
	bin, err := exec.LookPath("hysteria")
	if err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, bin, "version")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", err
	}
	return hy2update.NormalizeVersion(string(out)), nil
}

func hashFile(path string) string {
	if path == "" {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	// last_config_apply_at 是本地元信息，不参与面板期望配置哈希。
	data = []byte(stripApplyMetadata(string(data)))
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func readRevision(path string) int {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "# h2o-agent-revision:") {
			continue
		}
		var rev int
		_, _ = fmt.Sscanf(line, "# h2o-agent-revision: %d", &rev)
		return rev
	}
	return 0
}

func readApplyTime(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "# h2o-agent-applied-at:") {
			return strings.TrimSpace(
				strings.TrimPrefix(line, "# h2o-agent-applied-at:"),
			)
		}
	}
	return ""
}

func insertApplyTime(input, appliedAt string) string {
	lines := strings.Split(input, "\n")
	out := make([]string, 0, len(lines)+1)
	inserted := false
	for i, line := range lines {
		if strings.HasPrefix(line, "# h2o-agent-applied-at:") {
			continue
		}
		out = append(out, line)
		if i == 0 && strings.HasPrefix(line, "# h2o-agent-revision:") {
			out = append(out, "# h2o-agent-applied-at: "+appliedAt)
			inserted = true
		}
	}
	if !inserted {
		out = append([]string{"# h2o-agent-applied-at: " + appliedAt}, out...)
	}
	return strings.Join(out, "\n")
}

func stripApplyMetadata(input string) string {
	lines := strings.Split(input, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.HasPrefix(line, "# h2o-agent-applied-at:") {
			continue
		}
		out = append(out, line)
	}
	return strings.Join(out, "\n")
}

func writeConfigFileForService(ctx context.Context, path string, data []byte, serviceName string) error {
	if err := writeFileAtomic(path, data, 0600); err != nil {
		return err
	}
	return makeConfigReadableByService(ctx, path, serviceName)
}

func ensureExistingConfigReadable(ctx context.Context, path string, serviceName string) error {
	if path == "" {
		return nil
	}
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return makeConfigReadableByService(ctx, path, serviceName)
}

func makeConfigReadableByService(ctx context.Context, path string, serviceName string) error {
	if err := os.Chown(parentDir(path), 0, 0); err != nil {
		return err
	}
	if err := os.Chmod(parentDir(path), 0755); err != nil {
		return err
	}

	serviceUser, serviceGroup := detectSystemdServiceCredentials(ctx, serviceName)
	if serviceUser == "" || serviceUser == "root" {
		if err := os.Chown(path, 0, 0); err != nil {
			return err
		}
		return os.Chmod(path, 0600)
	}

	gid, err := serviceReadableGID(ctx, serviceUser, serviceGroup)
	if err != nil {
		if chownErr := os.Chown(path, 0, 0); chownErr != nil {
			return chownErr
		}
		return os.Chmod(path, 0600)
	}
	if err := os.Chown(path, 0, gid); err != nil {
		return err
	}
	return os.Chmod(path, 0640)
}

func detectSystemdServiceCredentials(ctx context.Context, serviceName string) (string, string) {
	if strings.TrimSpace(serviceName) == "" {
		return "", ""
	}
	out, err := exec.CommandContext(ctx, "systemctl", "show", serviceName, "--property=User", "--property=Group").Output()
	if err != nil {
		return "", ""
	}

	var user string
	var group string
	for _, line := range strings.Split(string(out), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		switch key {
		case "User":
			user = strings.TrimSpace(value)
		case "Group":
			group = strings.TrimSpace(value)
		}
	}
	return user, group
}

func serviceReadableGID(ctx context.Context, username, groupname string) (int, error) {
	if strings.TrimSpace(groupname) != "" {
		return lookupGroupGID(ctx, groupname)
	}
	return lookupUserPrimaryGID(ctx, username)
}

func lookupUserPrimaryGID(ctx context.Context, username string) (int, error) {
	out, err := exec.CommandContext(ctx, "id", "-g", username).Output()
	if err != nil {
		return 0, err
	}
	return parseGID(strings.TrimSpace(string(out)))
}

func lookupGroupGID(ctx context.Context, groupname string) (int, error) {
	if gid, err := parseGID(strings.TrimSpace(groupname)); err == nil {
		return gid, nil
	}

	if out, err := exec.CommandContext(ctx, "getent", "group", groupname).Output(); err == nil {
		if gid, err := parseGroupEntryGID(strings.TrimSpace(string(out))); err == nil {
			return gid, nil
		}
	}

	data, err := os.ReadFile("/etc/group")
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, groupname+":") {
			continue
		}
		return parseGroupEntryGID(line)
	}
	return 0, fmt.Errorf("服务组不存在: %s", groupname)
}

func parseGroupEntryGID(entry string) (int, error) {
	fields := strings.Split(entry, ":")
	if len(fields) < 3 {
		return 0, fmt.Errorf("组信息格式不合法")
	}
	return parseGID(fields[2])
}

func parseGID(value string) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, fmt.Errorf("GID 为空")
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("GID 不合法: %s", value)
		}
	}

	var gid int
	if _, err := fmt.Sscanf(value, "%d", &gid); err != nil {
		return 0, err
	}
	return gid, nil
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(parentDir(path), 0755); err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.tmp.%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func copyFile(src, dst string, perm os.FileMode) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(parentDir(dst), 0755); err != nil {
		return err
	}
	return os.WriteFile(dst, data, perm)
}

func parentDir(path string) string {
	idx := strings.LastIndex(path, "/")
	if idx <= 0 {
		return "."
	}
	return path[:idx]
}

func succeededTask(id int64, result interface{}) TaskResult {
	return TaskResult{ID: id, Status: "succeeded", Result: result}
}

func failedTask(id int64, err error) TaskResult {
	return TaskResult{ID: id, Status: "failed", Error: err.Error()}
}

func shouldRestartAgent(results []TaskResult) bool {
	for _, result := range results {
		if result.RestartAgent {
			return true
		}
	}
	return false
}

func restartAgentService(ctx context.Context) error {
	const serviceName = "h2o-agent"
	if !safeServiceName(serviceName) {
		return fmt.Errorf("服务名不合法: %s", serviceName)
	}

	manager := detectServiceManager()
	restartCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	switch manager {
	case "systemd":
		cmd = exec.CommandContext(
			restartCtx,
			"systemctl",
			"--no-block",
			"restart",
			serviceName,
		)
	case "openrc":
		// OpenRC 没有等价的 --no-block；后台延迟执行，避免当前进程被 stop 阶段打断。
		cmd = exec.CommandContext(
			restartCtx,
			"sh",
			"-c",
			"sleep 1; rc-service h2o-agent restart >/dev/null 2>&1 &",
		)
	default:
		return fmt.Errorf("未检测到支持的服务管理器")
	}

	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf(
			"restart %s 失败: %w: %s",
			serviceName,
			err,
			trimOutput(string(out), 2000),
		)
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func trimOutput(input string, max int) string {
	input = strings.TrimSpace(input)
	runes := []rune(input)
	if len(runes) <= max {
		return input
	}
	return string(runes[:max])
}
