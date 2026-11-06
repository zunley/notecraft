/**
 * 运行时服务端地址（Web 容器部署形态）。
 *
 * 默认空串 = 同源（推荐：Web 容器 nginx 把 /api、/health 代理到服务端，浏览器零 CORS）。
 * Dockerfile.web 在容器启动时用 NOTE_MD_SERVER_URL 环境变量重写本文件——
 * 同一镜像无需重建即可指向任意服务端（直连模式，需服务端配 NOTE_MD_ALLOWED_ORIGINS）。
 * 本地开发/服务端托管形态不受影响（值为空）。
 */
window.__NOTE_MD_SERVER__ = "";
