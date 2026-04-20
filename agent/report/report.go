package report

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"h2o-agent/stats"
)

// Send 把一次快照上报到 h2o 的 /api/node/auth/{authPath}/traffic
func Send(h2oURL, authPath string, snap *stats.Snapshot) error {
	body, err := json.Marshal(snap)
	if err != nil {
		return err
	}

	target := fmt.Sprintf(
		"%s/api/node/auth/%s/traffic",
		strings.TrimRight(h2oURL, "/"),
		url.PathEscape(authPath),
	)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(data))
	}
	return nil
}
