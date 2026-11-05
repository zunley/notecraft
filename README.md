# notecraft — 本地优先的跨平台 Markdown 笔记本

跑在 Windows / Linux / macOS / iOS / Android / Web 六端的本地优先 Markdown 笔记本：
笔记就是磁盘上的纯 `.md` 文件，离线可用，内置 AI 助手帮你查找与整理，
跨设备经服务端同步——**服务端零知识，永远读不到笔记内容**。

> 状态：**开发中**（骨架阶段），快速开始待首个里程碑发布。

## 功能

- 文件树、内联/分栏编辑、全文搜索、内链与回收站——全部本地完成，离线可用
- 客户端 AI 助手：文件工具直接读写本地笔记，LLM 经服务端中继（密钥不出服务端，中继零留存，会话只存本机）
- 端到端加密同步：服务端只见密文（连文件路径都加密），一个口令登录即解锁，加密对用户无感
- 跨设备同步：manifest + 乐观锁，冲突自动另存副本
- 开放注册的 username + password 登录（服务端可服务每一个安装应用的用户，互相隔离），一套代码打包六端

## 文档

- 设计定稿：[docs/DESIGN.md](docs/DESIGN.md)
- 接口规格：[docs/API.md](docs/API.md)
- 项目架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 样式定稿：[docs/style/](docs/style/README.md)
