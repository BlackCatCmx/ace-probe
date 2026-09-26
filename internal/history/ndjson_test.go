package history

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"ace-probe/internal/collect"
)

func TestAppendRepairsTailAndReplacesLatest(t *testing.T) {
	output := t.TempDir()
	first := collect.Record{Time: time.Date(2026, 9, 26, 10, 0, 0, 0, time.UTC).UnixMilli()}
	if err := Append(output, first); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(output, "data", "2026-09-26.ndjson")
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(`{"time":`); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	second := collect.Record{Time: first.Time + 60_000}
	if err := Append(output, second); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(bytes.TrimSuffix(content, []byte{'\n'}), []byte{'\n'})
	if len(lines) != 2 {
		t.Fatalf("应保留两条完整记录，得到 %d 条", len(lines))
	}
	for _, line := range lines {
		var record collect.Record
		if err := json.Unmarshal(line, &record); err != nil {
			t.Fatalf("历史记录损坏: %v", err)
		}
	}
	latest, err := LoadLatest(output)
	if err != nil || latest.Time != second.Time {
		t.Fatalf("最新记录未更新: %v, %v", latest, err)
	}
}

func TestAppendRemovesOnlyOldDays(t *testing.T) {
	output := t.TempDir()
	dataDir := filepath.Join(output, "data")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(dataDir, "2026-09-24.ndjson")
	yesterday := filepath.Join(dataDir, "2026-09-25.ndjson")
	other := filepath.Join(dataDir, "notes.ndjson")
	for _, path := range []string{old, yesterday, other} {
		if err := os.WriteFile(path, nil, 0644); err != nil {
			t.Fatal(err)
		}
	}
	record := collect.Record{Time: time.Date(2026, 9, 26, 10, 0, 0, 0, time.UTC).UnixMilli()}
	if err := Append(output, record); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("过期文件仍存在: %v", err)
	}
	for _, path := range []string{yesterday, other} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("不应删除 %s: %v", path, err)
		}
	}
}
