package history

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ace-probe/internal/collect"
)

func LoadLatest(outputDir string) (*collect.Record, error) {
	data, err := os.ReadFile(filepath.Join(outputDir, "data", "latest.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var record collect.Record
	if err := json.Unmarshal(data, &record); err != nil {
		return nil, fmt.Errorf("解析上次采样: %w", err)
	}
	return &record, nil
}

func Append(outputDir string, record collect.Record) error {
	dataDir := filepath.Join(outputDir, "data")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}
	day := time.UnixMilli(record.Time).UTC().Format("2006-01-02")
	path := filepath.Join(dataDir, day+".ndjson")
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0644)
	if err != nil {
		return err
	}
	if err := repairTail(file); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Seek(0, io.SeekEnd); err != nil {
		file.Close()
		return err
	}
	data, err := json.Marshal(record)
	if err != nil {
		file.Close()
		return err
	}
	line := append(data, '\n')
	if n, writeErr := file.Write(line); writeErr != nil || n != len(line) {
		file.Close()
		return fmt.Errorf("追加采样记录: %w", firstError(writeErr, io.ErrShortWrite))
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := writeLatest(dataDir, data); err != nil {
		return err
	}
	return removeOldDays(dataDir, time.UnixMilli(record.Time).UTC())
}

func repairTail(file *os.File) error {
	info, err := file.Stat()
	if err != nil || info.Size() == 0 {
		return err
	}
	end := info.Size()
	buf := make([]byte, 4096)
	for end > 0 {
		start := max(0, end-int64(len(buf)))
		n, err := file.ReadAt(buf[:end-start], start)
		if err != nil && err != io.EOF {
			return err
		}
		if end == info.Size() && n > 0 && buf[n-1] == '\n' {
			return nil
		}
		if i := bytes.LastIndexByte(buf[:n], '\n'); i >= 0 {
			return file.Truncate(start + int64(i) + 1)
		}
		end = start
	}
	return file.Truncate(0)
}

func writeLatest(dataDir string, data []byte) error {
	file, err := os.CreateTemp(dataDir, ".latest-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0644); err != nil {
		file.Close()
		return err
	}
	if n, writeErr := file.Write(data); writeErr != nil || n != len(data) {
		file.Close()
		return fmt.Errorf("写入最新采样: %w", firstError(writeErr, io.ErrShortWrite))
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(dataDir, "latest.json"))
}

func removeOldDays(dataDir string, now time.Time) error {
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return err
	}
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	yesterday := dayStart.Add(-24 * time.Hour)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".ndjson") {
			continue
		}
		day, err := time.Parse("2006-01-02", strings.TrimSuffix(entry.Name(), ".ndjson"))
		if err == nil && day.Before(yesterday) {
			if err := os.Remove(filepath.Join(dataDir, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

func firstError(err, otherwise error) error {
	if err != nil {
		return err
	}
	return otherwise
}
