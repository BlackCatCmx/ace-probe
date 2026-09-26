package collect

import (
	"context"
	"fmt"
	"sync"
	"time"

	"ace-probe/internal/docker"
)

type RawCPU struct {
	Total  uint64 `json:"total"`
	System uint64 `json:"system"`
	Cores  uint32 `json:"cores"`
}

type Metric struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	State       string   `json:"state"`
	CPUPercent  *float64 `json:"cpu_percent"`
	MemoryBytes *uint64  `json:"memory_bytes"`
	RawCPU      *RawCPU  `json:"raw_cpu,omitempty"`
}

type HostRawCPU struct {
	Total uint64 `json:"total"`
	Idle  uint64 `json:"idle"`
}

type HostMetric struct {
	CPUPercent       *float64    `json:"cpu_percent"`
	MemoryBytes      uint64      `json:"memory_bytes"`
	MemoryTotalBytes uint64      `json:"memory_total_bytes"`
	RawCPU           *HostRawCPU `json:"raw_cpu"`
}

type Record struct {
	Time       int64       `json:"time"`
	Host       *HostMetric `json:"host,omitempty"`
	Containers []Metric    `json:"containers"`
}

func Run(ctx context.Context, client *docker.Client, previous *Record) (Record, []error, error) {
	var previousHost *HostMetric
	if previous != nil {
		previousHost = previous.Host
	}
	host, err := sampleHost(previousHost)
	if err != nil {
		return Record{}, nil, fmt.Errorf("读取整机资源: %w", err)
	}
	containers, err := client.List(ctx)
	if err != nil {
		return Record{}, nil, fmt.Errorf("读取容器列表: %w", err)
	}
	record := Record{Time: time.Now().UTC().UnixMilli(), Host: host, Containers: make([]Metric, len(containers))}
	previousCPU := make(map[string]*RawCPU)
	if previous != nil {
		for _, item := range previous.Containers {
			previousCPU[item.ID] = item.RawCPU
		}
	}

	errs := make([]error, len(containers))
	semaphore := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, container := range containers {
		record.Containers[i] = Metric{ID: container.ID, Name: container.Name, State: container.State}
		if container.State != "running" {
			continue
		}
		wg.Add(1)
		semaphore <- struct{}{}
		go func(i int, container docker.Container) {
			defer wg.Done()
			defer func() { <-semaphore }()
			stats, err := client.Stats(ctx, container.ID)
			if err != nil {
				errs[i] = fmt.Errorf("容器 %s: %w", container.Name, err)
				return
			}
			metric := &record.Containers[i]
			metric.RawCPU = &RawCPU{
				Total:  stats.CPUStats.CPUUsage.TotalUsage,
				System: stats.CPUStats.SystemUsage,
				Cores:  stats.CPUStats.OnlineCPUs,
			}
			metric.CPUPercent = cpuPercent(metric.RawCPU, previousCPU[container.ID])
			metric.MemoryBytes, errs[i] = memoryBytes(stats, client.CgroupVersion)
			if errs[i] != nil {
				errs[i] = fmt.Errorf("容器 %s: %w", container.Name, errs[i])
			}
		}(i, container)
	}
	wg.Wait()

	var warnings []error
	for _, err := range errs {
		if err != nil {
			warnings = append(warnings, err)
		}
	}
	return record, warnings, nil
}

func cpuPercent(current, previous *RawCPU) *float64 {
	if previous == nil || current.Cores == 0 || current.Total < previous.Total || current.System <= previous.System {
		return nil
	}
	value := float64(current.Total-previous.Total) / float64(current.System-previous.System) * float64(current.Cores) * 100
	return &value
}

func memoryBytes(stats docker.Stats, cgroupVersion string) (*uint64, error) {
	key := "inactive_file"
	if cgroupVersion == "1" {
		key = "total_inactive_file"
	}
	cache, ok := stats.MemoryStats.Stats[key]
	if !ok {
		return nil, fmt.Errorf("Docker 统计缺少 %s", key)
	}
	usage := stats.MemoryStats.Usage
	if cache > usage {
		return nil, fmt.Errorf("Docker 内存缓存大于总用量")
	}
	value := usage - cache
	return &value, nil
}
