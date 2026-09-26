package collect

import "testing"

func TestHostCPU(t *testing.T) {
	current, err := parseHostCPU([]byte("cpu  10 20 30 40 50 60 70 80 90 100\n"))
	if err != nil || current.Total != 360 || current.Idle != 90 {
		t.Fatalf("CPU 计数器解析错误: %+v, %v", current, err)
	}
	previous := &HostRawCPU{Total: 160, Idle: 40}
	if got := hostCPUPercent(current, previous); got == nil || *got != 75 {
		t.Fatalf("整机 CPU 应为 75%%，得到 %v", got)
	}
	if got := hostCPUPercent(current, nil); got != nil {
		t.Fatalf("首次采样应为空，得到 %v", *got)
	}
}

func TestHostMemory(t *testing.T) {
	data := []byte("MemTotal:        2048 kB\nMemFree:          100 kB\nMemAvailable:     512 kB\n")
	used, total, err := parseHostMemory(data)
	if err != nil || used != 1536*1024 || total != 2048*1024 {
		t.Fatalf("整机内存应为 1536/2048 KiB，得到 %d/%d，错误 %v", used, total, err)
	}
}
