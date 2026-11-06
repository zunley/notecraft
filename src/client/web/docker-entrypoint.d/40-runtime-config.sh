#!/bin/sh
# 写入运行时服务端地址：config.ts 读取 window.__NOTE_MD_SERVER__
# - NOTE_MD_SERVER_URL 为空（默认）= 同源（经本容器 nginx 代理）
# - 设为 https://api.example.com = 直连模式（服务端需配 NOTE_MD_ALLOWED_ORIGINS）
# 剥除引号/反斜杠，杜绝注入（URL 不含此类字符）
server_url=$(printf '%s' "${NOTE_MD_SERVER_URL:-}" | tr -d '"\\')
printf 'window.__NOTE_MD_SERVER__ = "%s";\n' "$server_url" > /usr/share/nginx/html/runtime-config.js
