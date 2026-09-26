package collect

import (
	"testing"

	"ace-probe/internal/docker"
)

func TestCPUPercent(t *testing.T) {
	previous := &RawCPU{Total: 1_000, System: 10_000, Cores: 2}
	current := &RawCPU{Total: 2_000, System: 11_000, Cores: 2}
	if got := cpuPercent(current, previous); got == nil || *got != 200 {
		t.Fatalf("双核满载应为 200%%，得到 %v", got)
	}
	if got := cpuPercent(current, nil); got != nil {
		t.Fatalf("首次采样应为空，得到 %v", *got)
	}
	if got := cpuPercent(&RawCPU{Total: 500, System: 12_000, Cores: 2}, previous); got != nil {
		t.Fatalf("计数器重置应为空，得到 %v", *got)
	}
	if got := cpuPercent(&RawCPU{Total: 1_000, System: 11_000, Cores: 2}, previous); got == nil || *got != 0 {
		t.Fatalf("空闲容器应为 0%%，得到 %v", got)
	}
}

func TestMemoryBytes(t *testing.T) {
	var stats docker.Stats
	stats.MemoryStats.Usage = 1000
	stats.MemoryStats.Stats = map[string]uint64{"inactive_file": 100, "total_inactive_file": 300}
	for _, test := range []struct {
		version string
		want    uint64
	}{{"1", 700}, {"2", 900}} {
		got, err := memoryBytes(stats, test.version)
		if err != nil || got == nil || *got != test.want {
			t.Fatalf("cgroup %s: 内存应为 %d，得到 %v，错误 %v", test.version, test.want, got, err)
		}
	}
	delete(stats.MemoryStats.Stats, "inactive_file")
	if _, err := memoryBytes(stats, "2"); err == nil {
		t.Fatal("缺失内存统计应返回错误")
	}
}
