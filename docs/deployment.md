# Docker Compose 部署与维护

## 首次启动

准备 Docker Desktop（Linux 容器模式）、Docker Compose 和 Node.js 26。先确认 `docker version` 同时显示 Client 与 Server。在 VS Code 中打开仓库根目录的终端，执行：

```powershell
node scripts/setup-compose.ts
docker compose config --quiet
docker compose up -d --build
docker compose ps -a
```

若 Windows 终端提示找不到 docker，可重开 VS Code 以刷新 PATH，或在当前终端执行：

```powershell
$env:Path += ';C:\Program Files\Docker\Docker\resources\bin'
```

初始化脚本创建被 Git 忽略的根目录 `.env`，生成独立随机数据库密码和 JWT 密钥；已有文件不覆盖。根目录 `.env` 仅供 Compose 使用，`backend/.env` 供本机开发使用。不要复制或展示真实凭据。首次构建从锁文件安装 Linux 依赖，不使用宿主机 node_modules 或 dist。

启动后访问：

- 管理后台：http://localhost:8088
- Swagger：http://localhost:8088/docs
- OpenAPI：http://localhost:8088/docs-json

默认容器数据库与本机开发数据库独立，首次使用需注册账号。需要让本机 PostgreSQL 与 8088 后台的用户、商品、分类互相同步时，使用同时指定 `-f docker-compose.yml -f docker-compose.sync.yml --profile sync` 的启动、停止命令；同步连接信息保存在被忽略的 `.env.sync.local` 中。修改根目录 `.env` 的 `WEB_PORT` 可更换入口端口。

## 启动顺序与数据

1. `db`：PostgreSQL 18，首次创建数据卷时初始化非超级用户 `silk_shop_app`，只用于项目库。
2. `migrate`：数据库就绪后运行 `prisma migrate deploy`；成功退出（Exited 0）是正常状态。
3. `backend`：迁移成功后启动 NestJS，运行时使用非 root 用户；健康检查确认 API 已可访问。
4. `frontend`：Nginx 提供前端生产构建，将 `/api` 和 Swagger 反向代理至后端，支持刷新详情页等 SPA 路由。

只有入口绑定到本机 8088，数据库和后端无宿主机端口映射。数据库持久化于 `silk-shop_postgres_data` 卷，PostgreSQL 18 的挂载路径为 `/var/lib/postgresql`。

保留根目录 `.env` 与数据卷并做好备份；已有卷上的账号密码不会因修改 `.env` 自动更改。轮换数据库密码需先通过数据库修改账号密码，再同步配置。不要删除卷来解决普通配置或认证问题。

## 日常操作

图片文件保存在 `backend/uploads/`，通过 bind mount 映射到容器 `/app/uploads`，重建容器不会删除文件。该目录及图片不提交 Git、不复制进构建镜像；备份时同时保存上传目录和数据库。Windows Docker Desktop 可直接使用；Linux 部署应先创建该目录，并赋予容器 node 用户（UID 1000）写权限。Nginx 请求体限制为 6 MiB（含 multipart 开销），后端单文件限制为 5 MiB；`/uploads/` 代理到后端并公开访问。

封面列新增后，本机与 Docker 库需分别部署迁移，并更新同步服务镜像以传递 `cover_image`。启用双向同步时，更新命令为 `docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync up -d --build --wait`。数据库同步只同步 URL；本机与容器共用本仓库的上传目录，部署到不同机器时需另行共享/复制图片文件。

```powershell
docker compose ps -a
docker compose logs --tail 80 db migrate backend frontend
docker compose stop
docker compose start
```

更新代码后执行 `docker compose up -d --build`。迁移记录持久化在数据库中，重复执行不会重复建表。迁移失败时检查 migrate 日志、数据库连接和实际表结构，再解决原因；不要盲目 reset 或删除数据。

`docker compose down` 删除项目容器和网络但保留数据卷。**不要加 `-v`，该参数会删除数据库卷。** 日志、`docker inspect` 和不带 `--quiet` 的 `docker compose config` 可能包含私密配置，分享前需脱敏。

## 回归测试

开发测试只能连接开发数据库。容器启动后，可在一次性迁移镜像容器内验证数据库约束和全部 HTTP 测试，不修改日常应用镜像：

```powershell
docker compose run --rm --no-deps --user root -e JWT_SECRET=compose-test-only-secret-0123456789abcdef0123456789abcdef migrate npm test
```

浏览器回归需先在宿主机安装前后端依赖、生成后端编译产物及安装 Edge：

```powershell
npm.cmd --prefix backend ci
npm.cmd --prefix backend run build
npm.cmd --prefix frontend ci
$env:E2E_COMPOSE = '1'
cd frontend
npm.cmd run test:e2e
Remove-Item Env:E2E_COMPOSE
```

该模式使用正在运行的容器服务（默认 http://127.0.0.1:8088），不另起开发服务。改了入口端口时设置 `E2E_BASE_URL`。Docker 不在 PATH 时设置 `DOCKER_EXECUTABLE` 为 docker.exe 的绝对路径。浏览器测试通过一次性容器清理自身随机前缀记录，数据库端口无需暴露。

## 环境故障与部署边界

引擎管道不存在时，先启动 Docker Desktop 并等待 Engine running；若出现 WSL 或虚拟化提示，完成提示中的系统组件配置或重启后再试。镜像/依赖下载失败应检查网络，不必删除已有数据卷。服务启动问题先看 `ps -a` 和对应日志。本机 8080 端口被 Windows 拒绝绑定，已改用并验证 8088；出现类似错误时修改 `WEB_PORT` 为可用端口。

此配置用于本机考核演示。对外服务前需单独配置域名与 HTTPS、数据库备份及共享限流存储。JWT 普通退出只清理浏览器令牌；默认有效期一小时。个人中心改密会通过 tokenVersion 撤销所有旧凭证。

个人中心升级需停止应用写入和旧同步进程，备份后在本机及 Docker 两套库分别部署 `20261103054143_user_token_version`，再启动新版后端、前端和同步镜像。仅新增带默认值的列，保留用户和密码；无 tokenVersion 的旧凭证升级后返回 401，所有现有会话需重新登录。双库凭证失效存在同步延迟；不要在未更新另一库结构/同步镜像时先开放改密。具体检查见 [个人中心说明](personal-center.md)。

## 已执行验收（2026-10-30）

Linux 隔离构建、空库初始化迁移、数据库容器重建后保留迁移及重复执行迁移均通过。79 项 HTTP 测试、2 项数据库验证及容器入口的 3 组 Edge 浏览器流程通过；数据库、后端、前端健康，Swagger/OpenAPI、前端详情页刷新正常。测试数据按随机前缀清理；未清空本机开发数据库。


## 三角色升级与首次管理员

迁移 SQL 与规则见 [角色权限说明](rbac.md)。升级时先备份两库并停止 backend/frontend/db-sync，分别执行两库 db:deploy，再一起更新应用与同步镜像。2026-11-04 已完成本机及 Docker 业务库升级，实际验证见下方记录。已有用户回填运营人员，新注册默认访客；分类全局共享，仅管理员可维护。

首次管理员需维护者指定已存在的用户名，在已更新且已迁移的目标主库运行一次：

~~~powershell
docker compose run --rm --no-deps migrate node dist/admin/bootstrap-admin.js <已存在的用户名>
~~~

本机方式是在 backend 目录确认 .env 后运行 npm.cmd run build，再运行 npm.cmd run admin:bootstrap -- <已存在的用户名>。已有管理员时脚本拒绝重复引导；不自动把某个真实用户提升为管理员。启用同步时只在主库引导，待角色/版本同步完成后重新登录。权限修改及版本撤销的跨库生效存在既有异步延迟，审计在操作源库保存。

## 三角色实际部署记录（2026-11-04）

- 已停止应用及同步写入，分别备份两套数据库，并用 pg_restore --list 验证备份可识别；备份保存在本机被 Git 忽略的 tools/installers/rbac-upgrade-* 目录，不上传仓库。
- 两库角色结构和已有账号回填迁移均已部署。依维护者明确选择，仅在 Docker 主库将 py666 引导为首次管理员，再由同步桥同步至本机库；其他四个已有账号保留运营人员角色，新注册默认访客。
- 前端镜像已重新构建；后端在线 npm ci 长时间无响应，本次核对旧迁移镜像与当前 package-lock.json 的 SHA-256 完全一致后，用临时 Dockerfile 复用其依赖，重新生成 Prisma Client、编译当前源码并离线裁剪生产依赖。迁移、运行及同步镜像均已更新；未修改依赖或提交临时构建文件。
- 数据库、后端、前端及同步桥均健康，http://localhost:8088 返回 200。迁移服务成功退出，两端未投递同步事件均为 0。
- 已在运行容器验证：管理员访问账号管理成功，运营人员访问返回 403；管理员及运营人员商品列表与总数符合各自归属范围，非所属商品详情返回 404；管理员旧版本凭证返回 401，Swagger 包含管理员接口。
- 已比较两库与升级前备份：5 个用户、2 个分类、3 个商品保留；除授权的管理员版本和更新时间变化外，原有字段与密码哈希均未改变。两库角色、凭证版本及密码哈希一致。

维护者下一步：使用 py666 原密码重新登录（必要时 Ctrl+F5），检查管理员标识及账号管理入口。首次管理员引导使该账号原有会话失效；后续角色变更也需重新登录。不要重复运行首次管理员引导。

## 共享商品读取与角色登录入口更新（2026-11-04）

已按新口径更新镜像并启动 8088 服务：所有登录角色可查看全部商品列表与详情，运营人员仅可修改/删除自己商品，访客只读，管理员管理全部商品。列表与总数仍共用相同筛选条件。登录页选择访客、运营人员或管理员入口，后端仅核对数据库角色，不赋权；py666 选择管理员，其他已有账号选择运营人员，新注册账号选择访客。

本次无需数据库迁移；数据库、前后端和同步桥均健康。运行容器验证 py666 与 py667 商品总数均为 3，跨创建者详情可读，Swagger 包含 loginRole 枚举。隔离库后端 221 项测试与浏览器 22 项场景通过，未对业务库创建测试账号或变更原有业务记录。浏览器如缓存旧页面，使用 Ctrl+F5。
