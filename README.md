# Ace Probe

轻量级 Linux 主机与 Docker 容器资源探针。Go 常驻进程每分钟采集一次宿主机和容器的 CPU、内存数据；静态网页提供最近 2、6、12 或 24 小时的趋势图，时间显示为 UTC+8。

页面由现有 Nginx 静态托管，探针通过 Docker Unix Socket 读取容器统计，不需要修改 AcePanel 或另建 Web 服务。

## 安装（Debian 13 + AcePanel）

需要 Linux amd64、Docker Engine API 1.41+ 和 AcePanel 网站；安装二进制无需 Go。

1. 从 GitHub `latest` Release 下载 `ace-probe-linux-amd64`，安装到系统可执行目录。
2. 将仓库 `web/` 内容放到网站的 `public/probe/` 目录。
3. 参考 `deploy/ace-probe.env.example` 设置 Docker Socket 与采样目录；确保服务账户可访问 Docker Socket、可写采样目录，Nginx 可读取网页和数据。
4. 安装 `deploy/ace-probe.service` 并启用服务。

访问 `https://你的域名/probe/` 查看数据。

## 开发构建

需要 Go 1.22 或更新版本。

```bash
go build -o ace-probe ./cmd/probe
go test ./...
```

在 Linux 主机运行时，输出目录需包含 `web/` 静态文件；探针会在该目录创建 `data/`，保存最新采样和按日归档的历史记录：

```bash
./ace-probe -docker-socket /var/run/docker.sock -output-dir ./web
```

程序启动后立即采集，之后每分钟采集一次。运行账户需要读取 Docker Socket，并能写入输出目录。

## 部署文件

```text
cmd/probe/main.go                 程序入口与定时采集
internal/collect/                 宿主机及容器资源采集
internal/docker/                  Docker Engine API 客户端
internal/history/                 最新数据与历史记录存储
deploy/ace-probe.service          systemd 常驻服务
deploy/ace-probe.env.example      服务环境变量示例
web/                              静态页面、图表与样式
.github/workflows/release.yml     发布 Linux amd64 二进制到 latest
```
