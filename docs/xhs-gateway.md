# 小红书媒体网关部署

Fish 只需安装一个 DSH 业务插件。小红书登录态由单独的浏览器服务维护。以下是与本版适配器配套的容器配置片段。

```yaml
services:
  backend:
    image: xpzouying/xiaohongshu-mcp@sha256:397dfd5361b25d1379d56e0218cff7ad2e1ed271e342ab580dbe7c082614e2f2
    env_file: [backend.env]
    command: ["./app", "-port", "127.0.0.1:18060"]
    shm_size: 192m
    volumes:
      - ./data:/app/data
      - ./exchange:/fish-media-exchange:ro
  gateway:
    image: node:24-bookworm-slim
    network_mode: service:backend
    depends_on: [backend]
    env_file: [backend.env]
    command: ["node", "/srv/xhs-gateway.mjs"]
    read_only: true
    volumes:
      - ./tools/xhs-gateway.mjs:/srv/xhs-gateway.mjs:ro
      - ./exchange:/fish-media-exchange
      - ./socket:/run/xhs-read
```

创建私有的 `data`、`exchange`、`socket` 目录，在 `backend.env` 中设置后端使用的 `AUTH_TOKEN` 和登录态路径。Fish 容器只挂载 socket 目录，示例网关将套接字授予 UID 1101，权限 0600。将 Fish 容器自己的回环端口转发到套接字（例如 `socat TCP-LISTEN:18060,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:/run/xhs-read/reader.sock`），在 Fish 设置中填写 `http://127.0.0.1:18060`。后端和网关均无需映射公网端口。

网关只转发列出的平台接口。媒体下载限于平台 CDN，图片发布只接收 Fish 选中的图片字节，每次在交换目录生成临时文件，操作结束即清理。视频按指定秒数取帧，字幕可用时单独读取。长视频超过单次 32 MiB 的读取上限时会报告无法读取该画面。
