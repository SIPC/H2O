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

	"h2o-agent/report"
	"h2o-agent/selfupdate"
	"h2o-agent/stats"
)

// Version 由构建脚本通过 -ldflags 注入，未注入时用于开发构建
var Version = "dev"

// 配置文件结构；字段名与 JSON 键保持 snake_case
type Config struct {
	H2OURL              string `json:"h2o_url"`
	AuthPath            string `json:"auth_path"`
	HysteriaStatsURL    string `json:"hysteria_stats_url"`
	HysteriaStatsSecret string `json:"hysteria_stats_secret"`
	IntervalSeconds     int    `json:"interval_seconds"`
	AutoUpdateEnabled   *bool  `json:"auto_update_enabled"`
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
		"[h2o-agent] 启动，版本 %s，上报间隔 %s，自动更新 %v",
		Version,
		interval,
		cfg.AutoUpdateEnabled != nil && *cfg.AutoUpdateEnabled,
	)

	// 启动时立即跑一轮，再按 ticker 运行
	runOnce(cfg)

	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[h2o-agent] 退出")
			return
		case <-tick.C:
			runOnce(cfg)
		}
	}
}

func runOnce(cfg *Config) {
	snap, err := stats.Fetch(cfg.HysteriaStatsURL, cfg.HysteriaStatsSecret)
	if err != nil {
		log.Printf("抓取 Hy2 stats 失败: %v", err)
		return
	}
	snap.AgentVersion = Version
	if err := report.Send(cfg.H2OURL, cfg.AuthPath, snap); err != nil {
		log.Printf("上报 h2o 失败: %v", err)
		return
	}
	log.Printf("上报成功: users=%d online=%d", len(snap.Traffic), len(snap.Online))
}
