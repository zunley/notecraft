#!/bin/sh
# 默认值（须在20-envsubst-on-templates.sh 之前执行；官方 entrypoint 以 source 方式运行本脚本）
# NOTE_MD_API_UPSTREAM：同源代理的目标（compose.web.yaml 中的服务名）
export NOTE_MD_API_UPSTREAM="${NOTE_MD_API_UPSTREAM:-http://server:8080}"
