.PHONY: dev dev-api dev-web test build up down logs clean release

PY ?= $(shell test -x .venv/bin/python && echo .venv/bin/python || echo python3)

# --- 开发 ---

# 同时起后端（热重载）与前端（Vite）
dev:
	@$(MAKE) -j2 dev-api dev-web

dev-api:
	cd src/server && $(PY) -m uvicorn app.main:app --reload

dev-web:
	cd src/client/web && npm run dev

# --- 测试 ---

test:
	$(PY) src/server/tests/smoke.py

# --- 构建与部署（服务端镜像 = 后端 + Web 静态资源）---

build:
	docker compose build --no-cache

up:
	docker compose up -d

deploy: build up

down:
	docker compose down

logs:
	docker compose logs -f

clean:
	docker compose down --rmi local -v
	rm -rf src/client/web/dist src/client/web/node_modules src/client/tauri/target

# --- 发布 ---
# 打 v* tag 触发 CI 释出镜像到 ghcr.io：make release VERSION=1.0.0
release:
ifndef VERSION
	$(error 用法: make release VERSION=1.0.0)
endif
	git tag v$(VERSION)
	git push origin main v$(VERSION)
