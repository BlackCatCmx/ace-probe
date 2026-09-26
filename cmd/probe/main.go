package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
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

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()
	client, err := docker.New(ctx, *socket)
	if err != nil {
		log.Fatal(err)
	}
	previous, err := history.LoadLatest(*output)
	if err != nil {
		log.Fatal(err)
	}
	record, warnings, err := collect.Run(ctx, client, previous)
	if err != nil {
		log.Fatal(err)
	}
	if err := history.Append(*output, record); err != nil {
		log.Fatal(err)
	}
	for _, warning := range warnings {
		log.Printf("采集警告: %v", warning)
	}
	fmt.Fprintf(os.Stdout, "已采集 %d 个容器\n", len(record.Containers))
}
