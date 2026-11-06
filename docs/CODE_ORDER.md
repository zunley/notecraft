# 实施记录（阶段 0–9 已全部完成）

> 本文件曾是编码顺序清单；现已全部落地，保留为一页实施记录。
> 逐阶段过程与决策见 git 历史（`feat(phase*)` / `feat(web)` / `refactor(deploy)` 提交）。
> 架构现状以 [ARCHITECTURE.md](ARCHITECTURE.md) 为准，未决项见其 §10。

| 阶段 | 内容 | 出口 |
|------|------|------|
| 0 | 公共地基：服务端 config/错误单源、客户端 lib/errors+config、theme tokens、依赖铁律 lint | 测试/构建/depcruise 可跑 |
| 1 | M1-a 本地存储与本地业务（OPFS、文件树、CodeMirror、搜索/内链/回收站） | 断网全功能可用 |
| 2 | M1-b 服务端认证（注册/登录/续期/换口令/注销、require_user、限速、错误翻译） | 全链路测试通过 |
| 3 | M1-c 加密与登录（Argon2id/HKDF/NC1 信封、登录即解锁、REK 恢复密钥） | **M1 出口** |
| 4 | M2 AI + 中继（10 工具注册表、工具循环、write-gate、SSE 传输、IndexedDB 会话、零留存中继） | **M2 出口** |
| 5 | M3 同步 + 零知识（codec 加密边界、engine 基线/冲突副本/删除传播、sync 全端点） | **M3 出口**（卷内无明文验收） |
| 6 | M4 Tauri 桌面（tauriFs 实现、图标、deb 安装包本机构建并启动验证） | Linux 包可用 |
| 7 | M5 响应式（快捷键平台归一、刘海屏安全区、触控细节） | 真机验证待办 |
| 8 | M6 打磨（⌘K 搜索面板、内链补全、CI、README 用户视角重写） | CI 测试+镜像流水线 |
| 9 | Web 版发布（运行时配置注入、CORS 白名单、Dockerfile.web、同源代理）→ **完全分容器重构**（服务端剥离静态、compose 单一编排、双镜像用户优先命名） | `docker compose up` 单源全通 |

**测试基线**：服务端 72 项 pytest（core 单测 + HTTP 集成 + AST 架构铁律 + 零知识验收）+
smoke；客户端 tsc/vite build + dependency-cruiser；Tauri `cargo check` + deb 构建。
