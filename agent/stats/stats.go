package stats

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// UserTraffic 对应 Hy2 /traffic 接口每个用户的 tx/rx 字节数
type UserTraffic struct {
	Tx int64 `json:"tx"`
	Rx int64 `json:"rx"`
}

// Snapshot 是每次抓取得到的全量快照，字段名与 h2o 侧 /traffic 路由期望的 JSON 对齐
type Snapshot struct {
	Traffic      map[string]UserTraffic `json:"traffic"`
	Online       map[string]int         `json:"online"`
	AgentVersion string                 `json:"agent_version,omitempty"`
}

// Fetch 并行拉取 /traffic 与 /online，超时 10s
func Fetch(baseURL, secret string) (*Snapshot, error) {
	base := strings.TrimRight(baseURL, "/")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var (
		wg      sync.WaitGroup
		traffic map[string]UserTraffic
		online  map[string]int
		tErr    error
		oErr    error
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		traffic, tErr = fetchJSON[map[string]UserTraffic](ctx, base+"/traffic", secret)
	}()
	go func() {
		defer wg.Done()
		online, oErr = fetchJSON[map[string]int](ctx, base+"/online", secret)
	}()
	wg.Wait()

	if tErr != nil {
		return nil, fmt.Errorf("拉 /traffic 失败: %w", tErr)
	}
	if oErr != nil {
		return nil, fmt.Errorf("拉 /online 失败: %w", oErr)
	}

	// Hy2 在没有任何用户时 /traffic 可能返回 null 或空对象；统一成空 map
	if traffic == nil {
		traffic = map[string]UserTraffic{}
	}
	if online == nil {
		online = map[string]int{}
	}

	return &Snapshot{Traffic: traffic, Online: online}, nil
}

func fetchJSON[T any](ctx context.Context, url, secret string) (T, error) {
	var zero T
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return zero, err
	}
	if secret != "" {
		req.Header.Set("Authorization", secret)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return zero, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return zero, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(data))
	}

	var out T
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return zero, err
	}
	return out, nil
}
