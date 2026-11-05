#!/bin/sh
# notecraft 容器入口：以 root 校正卷属主后降权到 notecraft 运行（标准降权模式）。
#
# 背景：compose 的 bind 挂载（./notes、./data）若由 docker 自动创建会是 root 属主，
# 镜像内应用用户（uid 1000）写不进——这里只校正两卷的顶层属主（O(1)，不递归，
# 卷内文件由应用自己创建，属主天然正确），随后 setpriv 降权执行 CMD。
set -e

if [ "$(id -u)" = "0" ]; then
  # 无条件校正顶层属主（O(1) 幂等；root 下 test -w 恒真，不能用作判断）
  chown notecraft:notecraft /notes /data 2>/dev/null || true
  exec setpriv --reuid=notecraft --regid=notecraft --init-groups "$@"
fi

exec "$@"
