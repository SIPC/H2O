package selfupdate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	releasesAPI = "https://api.github.com/repos/SIPC/H2O/releases/latest"
	repoRelease = "https://github.com/SIPC/H2O/releases/download"
)

type releaseInfo struct {
	TagName string `json:"tag_name"`
}

type Result struct {
	CurrentVersion string
	LatestVersion  string
	Updated        bool
	SkippedReason  string
}

func CheckAndUpdate(ctx context.Context, currentVersion string) (*Result, error) {
	latest, err := fetchLatestVersion(ctx)
	if err != nil {
		return nil, err
	}

	result := &Result{CurrentVersion: currentVersion, LatestVersion: latest}
	if currentVersion == "" || currentVersion == "dev" {
		result.SkippedReason = "当前为开发版本"
		return result, nil
	}
	if compareVersion(currentVersion, latest) >= 0 {
		result.SkippedReason = "已是最新版本"
		return result, nil
	}

	assetName, err := agentAssetName()
	if err != nil {
		return nil, err
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("获取当前二进制路径失败: %w", err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return nil, fmt.Errorf("解析当前二进制路径失败: %w", err)
	}

	url := fmt.Sprintf("%s/v%s/%s", repoRelease, latest, assetName)
	if err := downloadAndReplace(ctx, url, executable); err != nil {
		return nil, err
	}

	result.Updated = true
	return result, nil
}

func fetchLatestVersion(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releasesAPI, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "h2o-agent-selfupdate")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("检查 GitHub Release 失败: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	var info releaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", err
	}
	version := strings.TrimPrefix(strings.TrimSpace(info.TagName), "v")
	if version == "" {
		return "", errors.New("GitHub Release 缺少 tag_name")
	}
	return version, nil
}

func agentAssetName() (string, error) {
	switch runtime.GOARCH {
	case "amd64":
		return "h2o-agent-linux-amd64", nil
	case "arm64":
		return "h2o-agent-linux-arm64", nil
	default:
		return "", fmt.Errorf("当前架构不支持自动更新: %s", runtime.GOARCH)
	}
}

func downloadAndReplace(ctx context.Context, url, executable string) error {
	expectedSHA256, err := fetchSHA256(ctx, url+".sha256")
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "h2o-agent-selfupdate")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("下载新版本失败: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	dir := filepath.Dir(executable)
	tmp, err := os.CreateTemp(dir, ".h2o-agent-update-*")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, hasher), resp.Body); err != nil {
		tmp.Close()
		return fmt.Errorf("写入新版本失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	actualSHA256 := hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(actualSHA256, expectedSHA256) {
		return fmt.Errorf("SHA256 校验失败: expected=%s actual=%s", expectedSHA256, actualSHA256)
	}
	if err := os.Chmod(tmpPath, 0755); err != nil {
		return fmt.Errorf("设置新版本权限失败: %w", err)
	}

	backup := executable + ".bak"
	_ = os.Remove(backup)
	if err := os.Rename(executable, backup); err != nil {
		return fmt.Errorf("备份当前版本失败: %w", err)
	}
	if err := os.Rename(tmpPath, executable); err != nil {
		_ = os.Rename(backup, executable)
		return fmt.Errorf("替换当前版本失败: %w", err)
	}
	_ = os.Remove(backup)
	return nil
}

func fetchSHA256(ctx context.Context, url string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "h2o-agent-selfupdate")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("下载 SHA256 校验文件失败: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 || len(fields[0]) != 64 {
		return "", errors.New("SHA256 校验文件格式不合法")
	}
	if _, err := hex.DecodeString(fields[0]); err != nil {
		return "", fmt.Errorf("SHA256 校验值不合法: %w", err)
	}
	return strings.ToLower(fields[0]), nil
}

func compareVersion(current, latest string) int {
	currentParts := splitVersion(current)
	latestParts := splitVersion(latest)
	maxLen := len(currentParts)
	if len(latestParts) > maxLen {
		maxLen = len(latestParts)
	}
	for i := 0; i < maxLen; i++ {
		var c, l int
		if i < len(currentParts) {
			c = currentParts[i]
		}
		if i < len(latestParts) {
			l = latestParts[i]
		}
		if c > l {
			return 1
		}
		if c < l {
			return -1
		}
	}
	return 0
}

func splitVersion(version string) []int {
	parts := strings.FieldsFunc(version, func(r rune) bool {
		return r == '.' || r == '-' || r == '_' || r == 'v'
	})
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		n, err := strconv.Atoi(part)
		if err != nil {
			out = append(out, 0)
			continue
		}
		out = append(out, n)
	}
	return out
}
