package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	http          *http.Client
	apiVersion    string
	CgroupVersion string
}

type Container struct {
	ID    string
	Name  string
	State string
}

type Stats struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs  uint32 `json:"online_cpus"`
	} `json:"cpu_stats"`
	MemoryStats struct {
		Usage uint64            `json:"usage"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
}

func New(ctx context.Context, socket string) (*Client, error) {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		},
	}
	c := &Client{http: &http.Client{Transport: transport, Timeout: 10 * time.Second}}

	var version struct {
		APIVersion string `json:"ApiVersion"`
	}
	if err := c.get(ctx, "/version", &version); err != nil {
		return nil, fmt.Errorf("读取 Docker 版本: %w", err)
	}
	parts := strings.Split(version.APIVersion, ".")
	if len(parts) != 2 {
		return nil, fmt.Errorf("无法识别 Docker API 版本 %q", version.APIVersion)
	}
	major, majorErr := strconv.Atoi(parts[0])
	minor, minorErr := strconv.Atoi(parts[1])
	if majorErr != nil || minorErr != nil || major < 1 || (major == 1 && minor < 41) {
		return nil, fmt.Errorf("Docker API %q 不支持一次性统计，需要 1.41 或更新版本", version.APIVersion)
	}
	c.apiVersion = version.APIVersion

	var info struct {
		CgroupVersion string `json:"CgroupVersion"`
	}
	if err := c.get(ctx, "/v"+c.apiVersion+"/info", &info); err != nil {
		return nil, fmt.Errorf("读取 Docker cgroup 版本: %w", err)
	}
	if info.CgroupVersion != "1" && info.CgroupVersion != "2" {
		return nil, fmt.Errorf("不支持的 cgroup 版本 %q", info.CgroupVersion)
	}
	c.CgroupVersion = info.CgroupVersion
	return c, nil
}

func (c *Client) List(ctx context.Context) ([]Container, error) {
	var items []struct {
		ID    string   `json:"Id"`
		Names []string `json:"Names"`
		State string   `json:"State"`
	}
	if err := c.get(ctx, "/v"+c.apiVersion+"/containers/json?all=1", &items); err != nil {
		return nil, err
	}
	containers := make([]Container, len(items))
	for i, item := range items {
		name := item.ID[:min(len(item.ID), 12)]
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], "/")
		}
		containers[i] = Container{ID: item.ID, Name: name, State: item.State}
	}
	return containers, nil
}

func (c *Client) Stats(ctx context.Context, id string) (Stats, error) {
	var stats Stats
	path := "/v" + c.apiVersion + "/containers/" + url.PathEscape(id) + "/stats?stream=false&one-shot=true"
	err := c.get(ctx, path, &stats)
	return stats, err
}

func (c *Client) get(ctx context.Context, path string, value any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Docker API %s: %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(value)
}
