# ── 前端构建 ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY src/client/web/package.json src/client/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src/client/web/ ./
RUN npm run build

# ── 运行时 ───────────────────────────────────────────────
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 TZ=Asia/Shanghai
WORKDIR /app

COPY src/server/requirements.txt ./src/server/requirements.txt
RUN pip install --no-cache-dir -r src/server/requirements.txt

COPY src/server/ ./src/server/
COPY --from=web /build/dist ./src/client/web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN useradd -m notecraft && mkdir -p /notes /data && chown notecraft:notecraft /notes /data
# 以 root 启动：entrypoint 校正卷属主后降权到 notecraft（bind 挂载可能是 root 属主）

ENV NOTE_MD_ROOT=/notes
ENV NOTE_MD_DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:create_app", "--factory", "--app-dir", "src/server", "--host", "0.0.0.0", "--port", "8080"]
