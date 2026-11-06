.PHONY: dev dev-api dev-web tauri-dev tauri-build test build up down logs clean release

PY ?= $(shell test -x .venv/bin/python && echo .venv/bin/python || echo python3)

# --- 开发 ---

# 同时起后端（热重载）与前端（Vite）
dev:
	@$(MAKE) -j2 dev-api dev-web

dev-api:
	cd src/server && NOTE_MD_ROOT="$${NOTE_MD_ROOT:-$(CURDIR)/notes}" \
	  NOTE_MD_DATA_DIR="$${NOTE_MD_DATA_DIR:-$(CURDIR)/data}" \
	  $(PY) -m uvicorn app.main:create_app --factory --reload

dev-web:
	cd src/client/web && npm run dev

# --- Tauri 桌面（M4）---
# 本平台安装包：Linux=deb / macOS=dmg / Windows=nsis（跨平台出包在对应 OS 的 CI runner）
TAURI := $(CURDIR)/src/client/web/node_modules/.bin/tauri

tauri-dev:
	cd src/client/tauri && $(TAURI) dev

tauri-build: build-web
	cd src/client/tauri && $(TAURI) build

build-web:
	cd src/client/web && npm run build

# --- 测试 ---
# pytest：分层单测（fake ports）+ HTTP 集成（tmp 数据目录）+ 架构铁律；smoke 为独立冒烟入口
test:
	$(PY) -m pytest src/server/tests -q
	$(PY) src/server/tests/smoke.py

# --- 构建与部署（完全分容器：web + server 两镜像）---

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
# 打 v* tag 触发 CI 释出镜像到 ghcr.io 与桌面/Android 安装包：make release VERSION=1.0.0
release:
ifndef VERSION
	$(error 用法: make release VERSION=1.0.0)
endif
	git tag v$(VERSION)
	git push origin main v$(VERSION)
