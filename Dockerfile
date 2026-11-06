# notecraft 服务端镜像（纯 API：认证 / 同步 / LLM 中继）
# 完全分容器部署——静态 Web 由独立镜像 ghcr.io/zunley/notecraft 承载
# （Dockerfile.web），前端发版节奏与后端解耦，见 docs/ARCHITECTURE.md §7。
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 TZ=Asia/Shanghai
WORKDIR /app

COPY src/server/requirements.txt ./src/server/requirements.txt
RUN pip install --no-cache-dir -r src/server/requirements.txt

COPY src/server/ ./src/server/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN useradd -m notecraft && mkdir -p /notes /data && chown notecraft:notecraft /notes /data
# 以 root 启动：entrypoint 校正卷属主后降权到 notecraft（bind 挂载可能是 root 属主）

ENV NOTE_MD_ROOT=/notes
ENV NOTE_MD_DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:create_app", "--factory", "--app-dir", "src/server", "--host", "0.0.0.0", "--port", "8080"]
