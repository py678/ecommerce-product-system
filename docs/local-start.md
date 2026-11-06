# 本地启动与验证

## 准备

使用项目已验证的 Node.js 26、npm 和 PostgreSQL 18。Windows PowerShell 使用 `npm.cmd`，避免脚本执行策略阻止 npm.ps1。首次克隆后在仓库根目录执行 `git config core.hooksPath .githooks`。

依赖由 npm workspaces 统一管理，首次在根目录执行 `npm.cmd ci`，不在 backend/frontend 分别安装。任务编排与缓存见 [工具链说明](tooling.md)。

在 VS Code 通过“文件 → 打开文件夹”选择项目根目录，再用“终端 → 新建终端”执行下面的命令。React/NestJS 项目通过 npm 脚本启动；工具栏的“运行当前文件”无法直接启动整个项目。若只想使用容器版本，按 [Docker 部署指南](deployment.md) 操作，访问 8088；以下 5173/3000 为独立开发模式；已启用订单双库时，5173默认代理Docker8088，本机副本禁止商品/订单写入。

根据 `backend/.env.example` 配置被 Git 忽略的 `backend/.env`。数据库初始化、专用账号权限与迁移说明见 [数据库文档](database.md)。`DATABASE_URL` 应连接独立项目库；`JWT_SECRET` 使用至少 32 随机字节的密钥，不使用示例密码或提交真实凭据。

需要在本机 Prisma Studio 看到 8088 后台的数据时，需启用 `docker-compose.sync.yml` 中的同步服务。两边都运行时通常约 1–3 秒同步，Studio 需刷新表格；商品/订单仅 Docker PRIMARY 写入，本机 REPLICA 只读，用户/分类仍双向。

## 启动后端

在仓库根目录执行：

```powershell
npm.cmd run db:generate --workspace backend
npm.cmd run db:validate --workspace backend
npm.cmd run db:deploy --workspace backend
npm.cmd run dev --workspace backend
```

打开 http://localhost:3000/docs 查看 Swagger。数据库未运行、连接配置错误或 JWT 密钥不合要求时，应先修正配置。不要用 reset 清空已有数据库。

## 启动前端

另开终端，从仓库根目录执行：

```powershell
npm.cmd run dev --workspace frontend
```

打开 http://localhost:5173，自行注册后进入商品管理。先创建分类，再创建商品；只有商品创建者可编辑或删除该商品。有商品引用的分类须先移出商品才能删除。

开发服务固定使用 5173，端口占用会明确报错。可通过进程环境变量 `DEV_SERVER_PORT` 修改前端端口，通过 `DEV_API_TARGET` 修改 `/api` 代理目标（默认 http://127.0.0.1:8088）。本机开发代理到8088时，Compose显式允许 http://127.0.0.1:5173 的HTTP/Socket.IO来源。独立开发后端可将 DEV_API_TARGET 设置为 http://127.0.0.1:3000，同时配置匹配的 FRONTEND_ORIGIN。

## 验证

根目录执行 `npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run format:check`、`npm.cmd test`。全部隔离后端和浏览器回归使用 `npm.cmd run test:orders`；数据库与浏览器任务不缓存。

端到端测试需要本机 Edge、后端依赖和已迁移的开发数据库，自动构建并启动后端 3002、前端预览 5174，不复用日常开发服务。测试验证注册登录、CRUD、表单验证、会话恢复、移动端导航、权限展示、网络重试与会话过期；仅删除自身随机前缀的数据。不得连接生产数据库。截图与失败追踪存于忽略的 `frontend/test-results/`。

## 生产部署准备

前端 `npm.cmd run build` 生成 `frontend/dist` 静态文件。生产 Web 服务需将 `/api` 代理至后端，并对前端页面路由回退到 `index.html`；Vite 开发代理不会随静态文件发布。后端构建后使用 `npm.cmd run start:prod`，部署前执行迁移并注入数据库及 JWT 环境变量。生产访问应启用 HTTPS。

当前未实现服务端登出撤销或刷新令牌；退出仅删除浏览器令牌。容器配置、启动顺序、回归命令和故障排查见 [Docker 部署指南](deployment.md)。实际验收结果以项目计划中的验证记录为准。

## 订单隔离验证

根目录执行 npm.cmd run test:orders，由 Turbo 先构建两端，再运行隔离验证。脚本只在本机库创建随机 orders_test_ 命名空间，部署全部迁移后运行后端和Edge用例，最终只删除本次创建的命名空间；不向业务public表写入测试数据。双库测试命令见订单规格。

根目录 npm.cmd test、npm.cmd run test:orders、npm.cmd run db:verify 均自动使用随机隔离命名空间。不要直接将原始Vitest或数据库测试脚本指向业务public；验证脚本需要创建/删除其临时schema的权限。
