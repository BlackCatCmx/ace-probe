package collect

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

func sampleHost(previous *HostMetric) (*HostMetric, error) {
	stat, err := os.ReadFile("/proc/stat")
	if err != nil {
		return nil, err
	}
	meminfo, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return nil, err
	}
	cpu, err := parseHostCPU(stat)
	if err != nil {
		return nil, err
	}
	used, total, err := parseHostMemory(meminfo)
	if err != nil {
		return nil, err
	}
	metric := &HostMetric{MemoryBytes: used, MemoryTotalBytes: total, RawCPU: cpu}
	if previous != nil {
		metric.CPUPercent = hostCPUPercent(cpu, previous.RawCPU)
	}
	return metric, nil
}

func parseHostCPU(data []byte) (*HostRawCPU, error) {
	line, _, _ := strings.Cut(string(data), "\n")
	fields := strings.Fields(line)
	if len(fields) < 9 || fields[0] != "cpu" {
		return nil, fmt.Errorf("/proc/stat 缺少 CPU 计数器")
	}
	var values [8]uint64
	for i := range values {
		value, err := strconv.ParseUint(fields[i+1], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("解析 /proc/stat CPU 计数器: %w", err)
		}
		values[i] = value
	}
	var total uint64
	for _, value := range values {
		total += value
	}
	return &HostRawCPU{Total: total, Idle: values[3] + values[4]}, nil
}

func hostCPUPercent(current, previous *HostRawCPU) *float64 {
	if previous == nil || current.Total <= previous.Total || current.Idle < previous.Idle {
		return nil
	}
	total := current.Total - previous.Total
	idle := current.Idle - previous.Idle
	if idle > total {
		return nil
	}
	value := float64(total-idle) / float64(total) * 100
	return &value
}

func parseHostMemory(data []byte) (uint64, uint64, error) {
	var total, available uint64
	var hasTotal, hasAvailable bool
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 || fields[2] != "kB" {
			continue
		}
		var target *uint64
		switch fields[0] {
		case "MemTotal:":
			target, hasTotal = &total, true
		case "MemAvailable:":
			target, hasAvailable = &available, true
		default:
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0, 0, fmt.Errorf("解析 /proc/meminfo %s: %w", fields[0], err)
		}
		*target = value * 1024
	}
	if !hasTotal || !hasAvailable || available > total {
		return 0, 0, fmt.Errorf("/proc/meminfo 缺少有效的 MemTotal 或 MemAvailable")
	}
	return total - available, total, nil
}
