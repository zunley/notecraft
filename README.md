# notecraft — 本地优先的跨平台 Markdown 笔记本

跑在 Windows / Linux / macOS / iOS / Android / Web 六端的本地优先 Markdown 笔记本：
笔记就是磁盘上的纯 `.md` 文件，离线可用，内置 AI 助手帮你查找与整理，
跨设备经服务端同步——**服务端零知识，永远读不到笔记内容**。

## 功能

- 文件树、编辑/分栏预览、全文搜索（⌘K）、内链与回收站——全部本地完成，离线可用
- AI 助手：文件工具直接读写本地笔记，LLM 经服务端中继（密钥不出服务端、零留存、会话只存本机）
- 端到端加密同步：服务端只见密文（连文件路径都加密），一个口令登录即解锁
- 跨设备同步：乐观锁 + 冲突自动另存副本；开放注册，多用户互相隔离

## 快速开始

```bash
docker compose up -d
```

浏览器打开 http://localhost:8080/ 即可使用：不登录直接写笔记，注册/登录后开启同步与 AI。
（Web 与服务端两个容器一并启动，用户只需打开上面这个地址。）

桌面版（Windows / macOS / Linux 安装包）与 Android 版（APK）：随 `v*` tag 的 CI 发布释出（GitHub Releases）。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `NOTE_MD_REGISTRATION` | `open` | 注册策略：`open` / `invite` / `closed` |
| `NOTE_MD_INVITE_CODE` | — | `invite` 模式的邀请码 |
| `NOTE_MD_TOKEN_TTL` | `72h` | 登录有效期 |
| `NOTE_MD_WEB_PORT` | `8080` | Web 入口端口（用户唯一入口） |
| `NOTE_MD_PORT` | `8081` | 服务端 API 端口（桌面端同步 / 直连用） |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | — | LLM 网关（AI 中继用，仅服务端持有） |

完整清单与限速/配额默认值见 [docs/API.md](docs/API.md)。

## 文档

- 设计定稿：[docs/DESIGN.md](docs/DESIGN.md)
- 接口规格：[docs/API.md](docs/API.md)
- 项目架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 数据与同步：[docs/DATA.md](docs/DATA.md)（数据存在哪、同步怎么走）
- 样式定稿：[docs/style/](docs/style/README.md)
