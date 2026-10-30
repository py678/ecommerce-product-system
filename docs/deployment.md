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

默认容器数据库与本机开发数据库独立，首次使用需注册账号。需要让本机 PostgreSQL 与 8088 后台的用户、商品、分类互相同步时，按 [双向同步指南](database-sync.md) 配置并使用带 `docker-compose.sync.yml` 的完整启动、停止命令。修改根目录 `.env` 的 `WEB_PORT` 可更换入口端口。

## 启动顺序与数据

1. `db`：PostgreSQL 18，首次创建数据卷时初始化非超级用户 `silk_shop_app`，只用于项目库。
2. `migrate`：数据库就绪后运行 `prisma migrate deploy`；成功退出（Exited 0）是正常状态。
3. `backend`：迁移成功后启动 NestJS，运行时使用非 root 用户；健康检查确认 API 已可访问。
4. `frontend`：Nginx 提供前端生产构建，将 `/api` 和 Swagger 反向代理至后端，支持刷新详情页等 SPA 路由。

只有入口绑定到本机 8088，数据库和后端无宿主机端口映射。数据库持久化于 `silk-shop_postgres_data` 卷，PostgreSQL 18 的挂载路径为 `/var/lib/postgresql`。

保留根目录 `.env` 与数据卷并做好备份；已有卷上的账号密码不会因修改 `.env` 自动更改。轮换数据库密码需先通过数据库修改账号密码，再同步配置。不要删除卷来解决普通配置或认证问题。

## 日常操作

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

此配置用于本机考核演示。对外服务前需单独配置域名与 HTTPS、数据库备份及共享限流存储。JWT 目前无服务端登出撤销，退出只清理浏览器令牌；默认有效期一小时。

## 已执行验收（2026-10-30）

Linux 隔离构建、空库初始化迁移、数据库容器重建后保留迁移及重复执行迁移均通过。79 项 HTTP 测试、2 项数据库验证及容器入口的 3 组 Edge 浏览器流程通过；数据库、后端、前端健康，Swagger/OpenAPI、前端详情页刷新正常。测试数据按随机前缀清理；未清空本机开发数据库。
