package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ace-probe/internal/collect"
	"ace-probe/internal/docker"
	"ace-probe/internal/history"
)

func main() {
	socket := flag.String("docker-socket", "/var/run/docker.sock", "Docker Unix Socket 路径")
	output := flag.String("output-dir", "", "静态页面所在目录")
	flag.Parse()
	if *output == "" {
		log.Fatal("必须指定 -output-dir")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	client, err := docker.New(ctx, *socket)
	if err != nil {
		log.Fatal(err)
	}
	previous, err := history.LoadLatest(*output)
	if err != nil {
		log.Fatal(err)
	}
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		sampleCtx, cancel := context.WithTimeout(ctx, 50*time.Second)
		record, warnings, err := collect.Run(sampleCtx, client, previous)
		cancel()
		if err != nil {
			log.Printf("采集失败: %v", err)
		} else if err := history.Append(*output, record); err != nil {
			log.Printf("保存采样失败: %v", err)
		} else {
			previous = &record
			for _, warning := range warnings {
				log.Printf("采集警告: %v", warning)
			}
			log.Printf("已采集 %d 个容器", len(record.Containers))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
