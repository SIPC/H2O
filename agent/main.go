package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"h2o-agent/control"
	"h2o-agent/report"
	"h2o-agent/selfupdate"
	"h2o-agent/stats"
)

// Version 由构建脚本通过 -ldflags 注入，未注入时用于开发构建
var Version = "dev"

const initialRunDelay = 10 * time.Second

// 配置文件结构；字段名与 JSON 键保持 snake_case
type Config struct {
	H2OURL               string `json:"h2o_url"`
	AuthPath             string `json:"auth_path"`
	AgentSecret          string `json:"agent_secret"`
	ControlEnabled       *bool  `json:"control_enabled"`
	HysteriaStatsURL     string `json:"hysteria_stats_url"`
	HysteriaStatsSecret  string `json:"hysteria_stats_secret"`
	IntervalSeconds      int    `json:"interval_seconds"`
	AutoUpdateEnabled    *bool  `json:"auto_update_enabled"`
	Hy2AutoUpdateEnabled *bool  `json:"hy2_auto_update_enabled"`
	HysteriaConfigPath   string `json:"hysteria_config_path"`
	HysteriaServiceName  string `json:"hysteria_service_name"`
	AgentConfigPath      string `json:"agent_config_path"`
}

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, err
	}
	if c.IntervalSeconds <= 0 {
		c.IntervalSeconds = 120
	}
	if c.AutoUpdateEnabled == nil {
		defaultAutoUpdate := true
		c.AutoUpdateEnabled = &defaultAutoUpdate
	}
	if c.Hy2AutoUpdateEnabled == nil {
		defaultHy2AutoUpdate := true
		c.Hy2AutoUpdateEnabled = &defaultHy2AutoUpdate
	}
	if c.ControlEnabled == nil {
		defaultControl := c.AgentSecret != ""
		c.ControlEnabled = &defaultControl
	}
	if c.HysteriaConfigPath == "" {
		c.HysteriaConfigPath = "/etc/hysteria/config.yaml"
	}
	if c.HysteriaServiceName == "" {
		c.HysteriaServiceName = "hysteria-server"
	}
	if c.AgentConfigPath == "" {
		c.AgentConfigPath = path
	}
	return &c, nil
}

func main() {
	configPath := flag.String("c", "config.json", "配置文件路径")
	selfUpdate := flag.Bool("self-update", false, "从 GitHub Release 检查并更新 agent")
	showVersion := flag.Bool("version", false, "打印 agent 版本")
	flag.Parse()

	if *showVersion {
		log.Printf("[h2o-agent] 版本: %s", Version)
		return
	}

	if *selfUpdate {
		cfg, err := loadConfig(*configPath)
		if err != nil {
			log.Fatalf("[h2o-agent] 读取配置失败: %v", err)
		}
		if cfg.AutoUpdateEnabled != nil && !*cfg.AutoUpdateEnabled {
			log.Printf("[h2o-agent] 自动更新已关闭")
			return
		}

		result, err := selfupdate.CheckAndUpdate(context.Background(), Version)
		if err != nil {
			log.Fatalf("[h2o-agent] 自动更新失败: %v", err)
		}
		if result.Updated {
			log.Printf("[h2o-agent] 已更新: %s -> %s", result.CurrentVersion, result.LatestVersion)
			os.Exit(2)
		}
		log.Printf("[h2o-agent] 无需更新: current=%s latest=%s reason=%s", result.CurrentVersion, result.LatestVersion, result.SkippedReason)
		return
	}

	abs, _ := filepath.Abs(*configPath)
	log.Printf("[h2o-agent] 加载配置: %s", abs)

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatalf("读取配置失败: %v", err)
	}
	if cfg.H2OURL == "" || cfg.AuthPath == "" || cfg.HysteriaStatsURL == "" {
		log.Fatalf("配置不完整: h2o_url / auth_path / hysteria_stats_url 必填")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	interval := time.Duration(cfg.IntervalSeconds) * time.Second
	log.Printf(
		"[h2o-agent] 启动，版本 %s，上报间隔 %s，Agent 自动更新 %v，Hy2 自动更新 %v",
		Version,
		interval,
		cfg.AutoUpdateEnabled != nil && *cfg.AutoUpdateEnabled,
		cfg.Hy2AutoUpdateEnabled != nil && *cfg.Hy2AutoUpdateEnabled,
	)

	var pendingControlResults []control.TaskResult

	// 首次启动时给 Hy2 预留证书申请/服务初始化时间，避免过早判断状态。
	log.Printf("[h2o-agent] 首次同步将在 %s 后开始", initialRunDelay)
	select {
	case <-ctx.Done():
		log.Println("[h2o-agent] 退出")
		return
	case <-time.After(initialRunDelay):
	}

	pendingControlResults = runOnce(ctx, cfg, pendingControlResults)

	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[h2o-agent] 退出")
			return
		case <-tick.C:
			pendingControlResults = runOnce(ctx, cfg, pendingControlResults)
		}
	}
}

func runOnce(ctx context.Context, cfg *Config, pending []control.TaskResult) []control.TaskResult {
	if cfg.ControlEnabled != nil && *cfg.ControlEnabled {
		resp, results, err := control.Sync(ctx, control.Config{
			H2OURL:               cfg.H2OURL,
			AuthPath:             cfg.AuthPath,
			AgentSecret:          cfg.AgentSecret,
			HysteriaConfigPath:   cfg.HysteriaConfigPath,
			HysteriaServiceName:  cfg.HysteriaServiceName,
			AgentConfigPath:      cfg.AgentConfigPath,
			AutoUpdateEnabled:    cfg.AutoUpdateEnabled != nil && *cfg.AutoUpdateEnabled,
			Hy2AutoUpdateEnabled: cfg.Hy2AutoUpdateEnabled != nil && *cfg.Hy2AutoUpdateEnabled,
			IntervalSeconds:      cfg.IntervalSeconds,
			HysteriaStatsURL:     cfg.HysteriaStatsURL,
			HysteriaStatsSecret:  cfg.HysteriaStatsSecret,
		}, Version, pending)
		if err != nil {
			log.Printf("同步控制面失败: %v", err)
			if len(results) > 0 {
				pending = results
				log.Printf("控制面任务结果将在下次同步重试: %d", len(results))
			}
		} else {
			applyPanelAgentConfig(cfg, resp)
			pending = results
			if len(results) > 0 {
				log.Printf("控制面同步成功，待回传任务结果: %d", len(results))
			} else {
				log.Printf("控制面同步成功")
			}
		}
	}

	maybeAutoUpdateHy2(ctx, cfg)

	snap, err := fetchStatsWithRetry(ctx, cfg)
	if err != nil {
		log.Printf("抓取 Hy2 stats 失败: %v", err)
		return pending
	}
	if err := sendReportWithRetry(ctx, cfg, snap); err != nil {
		log.Printf("上报 h2o 失败: %v", err)
		return pending
	}
	log.Printf("上报成功: users=%d online=%d", len(snap.Traffic), len(snap.Online))
	return pending
}

func applyPanelAgentConfig(cfg *Config, resp *control.SyncResponse) {
	if resp == nil || !resp.OK {
		return
	}
	if resp.Data.AgentConfig.IntervalSeconds > 0 {
		cfg.IntervalSeconds = resp.Data.AgentConfig.IntervalSeconds
	}
	if cfg.AutoUpdateEnabled == nil {
		cfg.AutoUpdateEnabled = new(bool)
	}
	*cfg.AutoUpdateEnabled = resp.Data.AgentConfig.AutoUpdateEnabled
	if resp.Data.AgentConfig.Hy2AutoUpdateEnabled != nil {
		if cfg.Hy2AutoUpdateEnabled == nil {
			cfg.Hy2AutoUpdateEnabled = new(bool)
		}
		*cfg.Hy2AutoUpdateEnabled = *resp.Data.AgentConfig.Hy2AutoUpdateEnabled
	}
	if resp.Data.AgentConfig.HysteriaStatsURL != "" {
		cfg.HysteriaStatsURL = resp.Data.AgentConfig.HysteriaStatsURL
	}
	if resp.Data.AgentConfig.HysteriaStatsSecret != "" {
		cfg.HysteriaStatsSecret = resp.Data.AgentConfig.HysteriaStatsSecret
	}
}

func maybeAutoUpdateHy2(ctx context.Context, cfg *Config) {
	if cfg.Hy2AutoUpdateEnabled == nil || !*cfg.Hy2AutoUpdateEnabled {
		return
	}
	result, err := control.MaybeAutoUpdateHy2(ctx, control.Config{
		HysteriaServiceName:  cfg.HysteriaServiceName,
		AgentConfigPath:      cfg.AgentConfigPath,
		Hy2AutoUpdateEnabled: true,
	})
	if err != nil {
		log.Printf("Hy2 自动更新失败: %v", err)
		return
	}
	if result == nil {
		return
	}
	if result.Updated {
		log.Printf("Hy2 已更新: %s -> %s", result.CurrentVersion, result.LatestVersion)
		return
	}
	log.Printf("Hy2 无需更新: current=%s latest=%s reason=%s", result.CurrentVersion, result.LatestVersion, result.SkippedReason)
}

func sendReportWithRetry(ctx context.Context, cfg *Config, snap *stats.Snapshot) error {
	delays := []time.Duration{2 * time.Second, 4 * time.Second}
	var lastErr error

	for attempt := 1; attempt <= 3; attempt++ {
		err := report.Send(cfg.H2OURL, cfg.AuthPath, snap)
		if err == nil {
			if attempt > 1 {
				log.Printf("上报 h2o 重试成功: attempt=%d", attempt)
			}
			return nil
		}

		lastErr = err
		if attempt == 3 {
			break
		}

		delay := delays[attempt-1]
		log.Printf("上报 h2o 失败: attempt=%d/3 err=%v，%s 后重试", attempt, err, delay)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}

	return lastErr
}

func fetchStatsWithRetry(ctx context.Context, cfg *Config) (*stats.Snapshot, error) {
	delays := []time.Duration{2 * time.Second, 4 * time.Second}
	var lastErr error

	for attempt := 1; attempt <= 3; attempt++ {
		snap, err := stats.Fetch(cfg.HysteriaStatsURL, cfg.HysteriaStatsSecret)
		if err == nil {
			if attempt > 1 {
				log.Printf("抓取 Hy2 stats 重试成功: attempt=%d", attempt)
			}
			return snap, nil
		}

		lastErr = err
		if attempt == 3 {
			break
		}

		delay := delays[attempt-1]
		log.Printf("抓取 Hy2 stats 失败: attempt=%d/3 err=%v，%s 后重试", attempt, err, delay)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(delay):
		}
	}

	return nil, lastErr
}
