package hy2update

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
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const releasesAPI = "https://api.github.com/repos/apernet/hysteria/releases/latest"

type releaseInfo struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		Name               string `json:"name"`
		Digest             string `json:"digest"`
		BrowserDownloadURL string `json:"browser_download_url"`
	} `json:"assets"`
}

type Result struct {
	CurrentVersion string
	LatestVersion  string
	Updated        bool
	SkippedReason  string
}

type restartFunc func(context.Context) error

func CheckAndUpdate(ctx context.Context, currentVersion string, restart restartFunc) (*Result, error) {
	latest, assetURL, expectedSHA256, err := fetchLatestRelease(ctx)
	if err != nil {
		return nil, err
	}

	current := NormalizeVersion(currentVersion)
	result := &Result{CurrentVersion: current, LatestVersion: latest}
	if current == "" {
		result.CurrentVersion = strings.TrimSpace(currentVersion)
		result.SkippedReason = "当前版本未知"
		return result, nil
	}
	if compareVersion(current, latest) >= 0 {
		result.SkippedReason = "已是最新版本"
		return result, nil
	}

	executable, err := exec.LookPath("hysteria")
	if err != nil {
		return nil, fmt.Errorf("未找到 hysteria 二进制: %w", err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return nil, fmt.Errorf("解析 hysteria 二进制路径失败: %w", err)
	}

	if err := downloadReplaceAndRestart(ctx, assetURL, executable, expectedSHA256, restart); err != nil {
		return nil, err
	}

	result.Updated = true
	return result, nil
}

func fetchLatestRelease(ctx context.Context) (version string, assetURL string, expectedSHA256 string, err error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releasesAPI, nil)
	if err != nil {
		return "", "", "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "h2o-agent-hy2update")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return "", "", "", fmt.Errorf("检查 Hysteria Release 失败: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	var info releaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return "", "", "", err
	}

	version = NormalizeVersion(info.TagName)
	if version == "" {
		return "", "", "", errors.New("Hysteria Release 缺少合法 tag_name")
	}

	assetName, err := assetName()
	if err != nil {
		return "", "", "", err
	}

	var hashesURL string
	for _, asset := range info.Assets {
		if asset.Name == "hashes.txt" {
			hashesURL = asset.BrowserDownloadURL
			continue
		}
		if asset.Name != assetName {
			continue
		}
		assetURL = asset.BrowserDownloadURL
		if strings.HasPrefix(strings.ToLower(asset.Digest), "sha256:") {
			expectedSHA256 = strings.TrimPrefix(strings.ToLower(asset.Digest), "sha256:")
		}
	}

	if assetURL == "" {
		return "", "", "", fmt.Errorf("Hysteria Release 缺少当前架构资源: %s", assetName)
	}
	if expectedSHA256 == "" && hashesURL != "" {
		expectedSHA256, err = fetchSHA256FromHashes(ctx, hashesURL, assetName)
		if err != nil {
			return "", "", "", err
		}
	}
	if expectedSHA256 == "" || !isSHA256(expectedSHA256) {
		return "", "", "", errors.New("Hysteria Release 缺少合法 SHA256 校验值")
	}
	return version, assetURL, expectedSHA256, nil
}

func assetName() (string, error) {
	switch runtime.GOARCH {
	case "amd64":
		return "hysteria-linux-amd64", nil
	case "arm64":
		return "hysteria-linux-arm64", nil
	default:
		return "", fmt.Errorf("当前架构不支持 Hy2 自动更新: %s", runtime.GOARCH)
	}
}

func fetchSHA256FromHashes(ctx context.Context, url, assetName string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "h2o-agent-hy2update")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("下载 Hysteria hashes.txt 失败: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || filepath.Base(fields[len(fields)-1]) != assetName {
			continue
		}
		value := strings.ToLower(fields[0])
		if !isSHA256(value) {
			return "", errors.New("Hysteria hashes.txt 中的 SHA256 不合法")
		}
		return value, nil
	}
	return "", fmt.Errorf("Hysteria hashes.txt 缺少资源校验值: %s", assetName)
}

func downloadReplaceAndRestart(ctx context.Context, url, executable, expectedSHA256 string, restart restartFunc) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "h2o-agent-hy2update")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("下载 Hysteria 新版本失败: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	dir := filepath.Dir(executable)
	tmp, err := os.CreateTemp(dir, ".hysteria-update-*")
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	hasher := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, hasher), resp.Body); err != nil {
		tmp.Close()
		return fmt.Errorf("写入 Hysteria 新版本失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	actualSHA256 := hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(actualSHA256, expectedSHA256) {
		return fmt.Errorf("Hysteria SHA256 校验失败: expected=%s actual=%s", expectedSHA256, actualSHA256)
	}
	if err := os.Chmod(tmpPath, 0755); err != nil {
		return fmt.Errorf("设置 Hysteria 新版本权限失败: %w", err)
	}

	backup := executable + ".h2o-bak"
	_ = os.Remove(backup)
	if err := os.Rename(executable, backup); err != nil {
		return fmt.Errorf("备份当前 Hysteria 失败: %w", err)
	}
	if err := os.Rename(tmpPath, executable); err != nil {
		_ = os.Rename(backup, executable)
		return fmt.Errorf("替换当前 Hysteria 失败: %w", err)
	}

	if restart != nil {
		if err := restart(ctx); err != nil {
			_ = os.Remove(executable + ".failed")
			_ = os.Rename(executable, executable+".failed")
			if rollbackErr := os.Rename(backup, executable); rollbackErr != nil {
				return fmt.Errorf("重启 Hysteria 失败且回滚二进制失败: restart=%v rollback=%v", err, rollbackErr)
			}
			if rollbackRestartErr := restart(ctx); rollbackRestartErr != nil {
				return fmt.Errorf("重启 Hysteria 失败，已回滚二进制但旧版本重启也失败: restart=%v rollback_restart=%v", err, rollbackRestartErr)
			}
			return fmt.Errorf("重启 Hysteria 失败，已回滚二进制: %w", err)
		}
	}

	_ = os.Remove(backup)
	return nil
}

func isSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

var (
	labeledVersionPattern = regexp.MustCompile(`(?im)^\s*Version:\s*(?:app/)?v?([0-9]+(?:\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?)\b`)
	versionPattern        = regexp.MustCompile(`(?i)^(?:app/)?v?([0-9]+(?:\.[0-9]+){1,3}(?:[-+][0-9A-Za-z.-]+)?)$`)
)

func NormalizeVersion(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if match := labeledVersionPattern.FindStringSubmatch(value); len(match) >= 2 {
		return match[1]
	}
	if match := versionPattern.FindStringSubmatch(value); len(match) >= 2 {
		return match[1]
	}
	return ""
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
	version = NormalizeVersion(version)
	parts := strings.FieldsFunc(version, func(r rune) bool {
		return r == '.' || r == '-' || r == '_' || r == 'v' || r == '+'
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
