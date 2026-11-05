# notecraft — 本地优先的跨平台 Markdown 笔记本

跑在 Windows / Linux / macOS / iOS / Android / Web 六端的本地优先 Markdown 笔记本：
笔记就是磁盘上的纯 `.md` 文件，离线可用，内置 AI 助手帮你查找与整理，跨设备经服务端同步。

> 状态：**开发中**（骨架阶段），快速开始待首个里程碑发布。

## 功能

- 文件树、内联/分栏编辑、全文搜索、内链与回收站——全部本地完成，离线可用
- 客户端 AI 助手：14 个文件工具直接读写本地笔记，LLM 经服务端中继（密钥不出服务端）
- 跨设备同步：manifest + 乐观锁，冲突自动另存副本
- username + password 登录，一套代码打包六端

## 文档

- 设计定稿：[docs/DESIGN-V2.md](docs/DESIGN-V2.md)
- 项目架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 样式定稿：[docs/style/](docs/style/README.md)
