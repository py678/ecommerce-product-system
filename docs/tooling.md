# npm workspaces 与 Turborepo

## 范围与安装

保留 backend/、frontend/ 和既有包名；根目录使用 npm workspaces、单一 package-lock.json 和 Turbo 2.11.10。Node.js 26、npm 11（packageManager 固定 npm@11.20.0），首次安装在根目录执行：

```powershell
npm.cmd ci
git config core.hooksPath .githooks
```

不再在子目录 npm ci，不维护子目录锁文件。依赖提升后模块可能位于根目录或 workspace 内；工具脚本通过 Node 模块解析寻找 CLI，不能拼接固定 node_modules 路径。为应用添加依赖使用 `npm.cmd install <包名> --workspace backend` 或 `--workspace frontend`；根目录工具用 `npm.cmd install -D <包名>`。

## 任务入口

以下均在根目录执行：

| 命令                                       | 作用                                                              |
| ------------------------------------------ | ----------------------------------------------------------------- |
| npm.cmd run dev                            | 同时启动 Nest watch 与 Vite；需预先配置独立开发数据库、JWT 与代理 |
| npm.cmd run dev --workspace frontend       | 仅前端，默认代理 Docker 8088，适合现有双库演示环境                |
| npm.cmd run build                          | 两端构建；先生成 Prisma Client 再编译后端                         |
| npm.cmd run build:backend / build:frontend | 仅构建对应应用                                                    |
| npm.cmd run lint / format:check            | 两端代码及格式检查                                                |
| npm.cmd run format                         | 格式化两端文件，不缓存                                            |
| npm.cmd test                               | 构建后端，运行随机 schema 隔离验证和全部后端测试                  |
| npm.cmd run db:verify                      | 构建后端，执行随机 schema 数据库验证                              |
| npm.cmd run test:orders                    | 构建两端，隔离执行全部后端与 Edge 回归                            |
| npm.cmd run test:realtime                  | 构建两端，隔离执行 Socket.IO 和浏览器验证                         |

`dev` 不运行数据库迁移、引导管理员、同步或 Docker 部署。独立开发需将 DEV_API_TARGET 指向对应后端并配置来源；现有 Docker PRIMARY / 本机 REPLICA 仍使用 8088 主服务写商品/订单，不通过本机副本写入。

迁移仍须 SQL 审查并显式执行 `npm.cmd run db:deploy --workspace backend`；不新增迁移、不更改数据库角色或业务逻辑。直接运行 workspace 内 build 时先执行 db:generate；直接运行测试脚本时先准备两端构建，推荐统一入口。

## 缓存与环境

- 仅本地文件系统缓存，禁用远程缓存；`.turbo/` 全部忽略。
- build 缓存 dist/，同时保留对应 TypeScript 增量文件；前端增量文件与 dist 一起恢复。后端生成客户端单独执行且禁用缓存，避免缓存命中后缺少生成源码。
- 源代码、应用配置、Prisma schema、workspace 依赖及锁文件参与任务哈希。修改前端业务源码不使后端重建；修改后端 schema 会使后端重新编译。
- 前端构建将 VITE__、NODE_ENV、DEV_API_TARGET、DEV_SERVER_PORT 和生产模式 .env 文件纳入缓存输入。真实凭据不提交，不将 .env 作为缓存输出；禁止在 VITE__ 放服务端密码或令牌。
- build 不依赖业务库连接或 JWT 密钥。dev/test 通过 passThroughEnv 接收明确列出的运行变量，也保留现有 backend/.env 加载；修改需要透传的环境变量时同步维护 turbo.json。
- lint、format:check 可缓存。format、Prisma generate、数据库和浏览器测试不缓存，集成测试不得因为上次通过而跳过。
- 测试中后端 3002、预览 5174 由 Playwright 启动，复用预先构建的产物；串行运行不同浏览器套件，避免端口争用。测试脚本继续创建和清理自己的随机 schema，不写业务 public。

排查缓存时执行 `npm.cmd exec -- turbo run build --force`；查看任务图和缓存状态用 `npm.cmd exec -- turbo run build --dry=json`。不要把迁移、库存写入或复制过程变成可缓存任务。

## Docker

Compose 的应用构建上下文统一为仓库根目录，使用 backend/Dockerfile 和 frontend/Dockerfile。镜像通过根锁文件安装对应 workspace 及根开发工具，执行筛选构建；不复制宿主机 node_modules、生成客户端、凭据和缓存。BuildKit 共享 npm 下载缓存并串行使用该缓存，网络失败重试；安装阶段验证 Turbo 平台可执行文件，避免可选包下载失败被静默忽略。暂不启用 turbo prune 或远程缓存。

后端迁移/同步工作目录为 /app/backend；运行镜像保留根与后端所需生产依赖、backend/dist、包清单，非 root 启动。运行依赖裁剪同时包含根 workspace，并省略 dev/optional，排除 Turbo 和 TypeScript 等开发工具；当前 PostgreSQL JS adapter 不依赖可选原生模块，迁移镜像仍保留完整开发工具。上传挂载从宿主机 backend/uploads 映射到 /app/backend/uploads，图片仍由同一宿主机目录保留。Nginx 仍提供 8088，HTTP/WebSocket 代理不变。

```powershell
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync up -d --build --wait
```

无同步环境可省略扩展配置。迁移阶段继续显式执行既有 migrate deploy，本次无新迁移。两库测试配置同步使用根构建上下文和新的脚本挂载路径。Docker 构建不需要先在宿主机 npm ci。

本次实施结果见提交正文；历史业务验收记录不作为本次工具链接入验证。

## 接入验证（2026-11-06）

- 最终根锁文件执行 npm ci 成功；已有依赖版本与原两份锁文件对比无变化，补齐原有跨平台可选依赖元数据，Windows 与 Linux 均可构建。
- 根目录 build、lint、format:check 通过；缓存探针验证前端配置、后端 schema、前端生产环境文件分别失效，删除 dist 后可恢复，生成客户端丢失后可重新生成。
- 临时端口启动根 dev 成功，验证 Nest、Vite 和代理环境透传，随后只关闭本次进程。
- 最终隔离回归：245 项后端、2 项数据库和 23 项 Edge 测试全部通过；临时 schema 已清理。并行镜像构建期间一次密码限流用例超时，构建空闲后整套重跑通过，没有修改业务或放宽断言。
- 新版 workspace 镜像通过旧同步 11 项、订单同步 4 项一次性双库验证。正式库备份归档列表已校验，部署前两边队列均为 0，六张业务表内容一致；不重新激活数据库角色。
- 后端运行镜像确认没有 turbo、prisma CLI、@nestjs/cli、typescript、vitest，迁移镜像保留验证所需开发依赖。
- Docker 前端、后端、数据库、同步桥健康，迁移阶段退出 0 且无待应用迁移；8088 登录态只读接口、订单浏览器页面、Swagger 与真实 WebSocket 连接验证通过，没有向业务库新增测试记录。
