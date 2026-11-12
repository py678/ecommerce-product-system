# Docker Compose 部署与维护

## 库存流水升级

迁移 `20261112021102_stock_movements` 须先审阅。升级前备份两库并验证备份归档，停止前端和后端写入（包括其他本地写入客户端），让旧同步桥排空双向队列并核对商品/订单；再停止旧桥。使用业务迁移账号分别部署两库迁移，Docker 必须为 PRIMARY，本机必须为 REPLICA。主库生成基线，副本不自行生成。

重建 backend/frontend/db-sync 镜像，启动新版同步桥，等待期初和凭证版本复制完成，核对两库库存/版本/流水 UUID 及内容一致、队列为零后恢复新版服务。系统角色账号需重新登录，自定义角色需另行授予 stock:read。不要 reset、丢弃队列或用副本重新执行扣补逻辑；迁移后不要直接回退到会漏写流水的旧后端继续营业，失败时先保持停写并排查或按已验证的备份恢复流程处理。

商品详情新增“库存流水”，订单详情新增“库存变动”。手动调整需原因；历史只从启用基线开始。验证入口：`npm test` 包含随机 schema 的流水/双库测试，`npm run test:orders` 再包含浏览器回归。测试不会清理业务库。

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

图片文件保存在 `backend/uploads/`，通过 bind mount 映射到容器 `/app/backend/uploads`，重建容器不会删除文件。该目录及图片不提交 Git、不复制进构建镜像；备份时同时保存上传目录和数据库。Windows Docker Desktop 可直接使用；Linux 部署应先创建该目录，并赋予容器 node 用户（UID 1000）写权限。Nginx 请求体限制为 6 MiB（含 multipart 开销），后端单文件限制为 5 MiB；`/uploads/` 代理到后端并公开访问。

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
npm.cmd ci
npm.cmd run build
$env:E2E_COMPOSE = '1'
cd frontend
npm.cmd run test:e2e
Remove-Item Env:E2E_COMPOSE
```

该模式使用正在运行的容器服务（默认 http://127.0.0.1:8088），不另起开发服务。改了入口端口时设置 `E2E_BASE_URL`。Docker 不在 PATH 时设置 `DOCKER_EXECUTABLE` 为 docker.exe 的绝对路径。浏览器测试通过一次性容器清理自身随机前缀记录，数据库端口无需暴露。

## 环境故障与部署边界

应用镜像使用根目录构建上下文、统一 workspace 锁文件；后端迁移与同步容器工作目录为 /app/backend。首次迁移工具链及缓存策略见 [Workspace 与 Turborepo](tooling.md)。原上传宿主机目录、数据库卷、端口及数据库角色不变，无需重新初始化或切换主副本。

引擎管道不存在时，先启动 Docker Desktop 并等待 Engine running；若出现 WSL 或虚拟化提示，完成提示中的系统组件配置或重启后再试。镜像/依赖下载失败应检查网络，不必删除已有数据卷。服务启动问题先看 `ps -a` 和对应日志。本机 8080 端口被 Windows 拒绝绑定，已改用并验证 8088；出现类似错误时修改 `WEB_PORT` 为可用端口。

此配置用于本机考核演示。对外服务前需单独配置域名与 HTTPS、数据库备份及共享限流存储。JWT 普通退出只清理浏览器令牌；默认有效期一小时。个人中心改密会通过 tokenVersion 撤销所有旧凭证。

个人中心升级需停止应用写入和旧同步进程，备份后在本机及 Docker 两套库分别部署 `20261103054143_user_token_version`，再启动新版后端、前端和同步镜像。仅新增带默认值的列，保留用户和密码；无 tokenVersion 的旧凭证升级后返回 401，所有现有会话需重新登录。双库凭证失效存在同步延迟；不要在未更新另一库结构/同步镜像时先开放改密。具体检查见 [个人中心说明](personal-center.md)。

## 已执行验收（2026-10-30）

Linux 隔离构建、空库初始化迁移、数据库容器重建后保留迁移及重复执行迁移均通过。79 项 HTTP 测试、2 项数据库验证及容器入口的 3 组 Edge 浏览器流程通过；数据库、后端、前端健康，Swagger/OpenAPI、前端详情页刷新正常。测试数据按随机前缀清理；未清空本机开发数据库。


## 两角色注册配置与升级

根目录 .env（Docker）和 backend/.env（本机）配置 ADMIN_REGISTRATION_COMPANY_ID；实际值由维护者私下设置，不写前端或版本库。留空时只有运营人员注册可用，管理员注册返回 503。Docker Compose 将此变量仅传给 backend；修改后需重新创建 backend。已有管理员登录不依赖此配置。

升级前停止 backend/frontend/db-sync 并备份两套数据库；在本机和 Docker 库分别部署 20261104081128_two_roles_admin_registration，再更新应用与同步镜像。迁移保留账号密码、商品和分类，旧只读账号转换为运营人员并递增版本，历史审计原文保留。不要删除已应用迁移、清空数据卷或执行 reset。

所有账号共享商品读取；运营人员仅修改/删除自己的商品，管理员管理全部商品并维护全局分类。登录页统一使用用户名和密码，注册页可选择运营人员或管理员，只有管理员注册需要公司内部 ID。当前 py666 继续为管理员。后台地址 http://localhost:8088，页面缓存时使用 Ctrl+F5。


本次验证与部署（2026-11-04）：前后端构建、ESLint 与 Prettier 通过；后端 10 个文件共 220 项测试通过，迁移数据保留及角色同步 2 项专项测试通过。浏览器全量 21 项中 20 项通过、1 项既有筛选测试因本机卡顿超时；该项在独立新测试 schema 重跑通过。两库迁移均已部署，数据与备份逐字段比较通过，数据库/前后端/同步桥均健康，同步队列清空。运行环境管理员注册缺少/错误内部 ID 返回 400 且未创建账号，配置值在模拟数据库验证中可注册管理员。两库账号、密码、商品、分类及原有审计保留；公司内部 ID 仅保存在被忽略的本机配置。

## Socket.IO 升级与验证

本次无需新增迁移。按原 Compose 命令加 --build 重建前后端；启用同步的环境保留 sync 组合配置。Nginx 同端口代理 /socket.io/，同时支持 polling 与 WebSocket，升级头、HTTP/1.1 和 75 秒超时已配置，不开放额外端口。FRONTEND_ORIGIN 必须与页面 Origin 完全一致，默认入口使用 http://localhost:8088。若另有外层网关，也需要保留 /socket.io/、Upgrade/Connection 和合适的超时。生产使用 HTTPS/WSS。详细启动及双窗口验收见 [实时通知规格](realtime.md#8-启动与双窗口手动验收)。单实例无需 Redis，扩容时再增加 adapter。

## 订单版本：双库维护升级

商品与订单改为Docker PRIMARY / 本机 REPLICA；用户/分类仍双向。旧桥必须升级，不能只重建前端。已有业务数据、账号密码与角色均保留。

1. 先构建镜像并完成隔离测试；进入维护窗口，停止前后端及任何本机业务写入。备份两库完整pg_dump，存入被忽略的备份目录，禁止提交。
2. 旧同步桥保持运行直到两边_sync_events的delivered_at IS NULL均为0，核对商品一致后停止桥。不得直接标记丢弃待同步事件。
3. 两边分别执行prisma migrate deploy（禁止reset）。迁移默认STANDALONE，此时继续保持维护。
4. 使用同步服务环境运行下面的检查与激活；脚本锁定两库业务表、验证空队列与六张表内容完全一致，然后设置互补角色。如果失败，保持维护，排查后重试；不要恢复成双主。
5. 重建并启动后端、前端和同步桥，确认健康、两库迁移状态与角色正确。访问8088订单页验收。

```powershell
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync build migrate backend frontend db-sync
# 完成备份与停止业务写入、排空旧队列后：
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync stop db-sync
docker compose run --rm migrate
# 本机库另在backend目录执行 npm.cmd run db:deploy
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync run --rm --no-deps db-sync node scripts/commerce-cutover.ts
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync run --rm --no-deps db-sync node scripts/commerce-cutover.ts --activate
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync up -d --build
```

以后日常启动继续使用最后一条命令，不重复角色切换。不使用本机副本后端修改商品/录单；5173默认代理8088主服务。独立开发/测试才使用STANDALONE和自己的数据库。图片仍位于既有共享uploads目录，数据库只同步URL。

一致性检查会将两个会话时区统一为UTC再比较TIMESTAMPTZ，避免本机Asia/Shanghai与容器UTC的显示差异误报。当前部署已按上述流程完成角色激活；后续日常启动不要重复执行初始化或切换脚本。

## 可配置 RBAC 升级

迁移 20261110023925_configurable_rbac 已按 --create-only 生成并审查。升级会保留账号、密码及所有业务数据，新增角色/权限/审计结构，回填 roleId 并递增全部账号的 tokenVersion；升级后必须重新登录。

1. 根目录运行 build、lint、format:check、test:orders，在隔离环境验证空库迁移、旧数据保留及角色原子同步。
2. 进入维护窗口，停止前后端及本机写入；让旧同步桥排空两侧队列，核对原有六张业务表一致后停止同步桥。
3. 对 Docker PRIMARY 与本机 REPLICA 分别执行完整 pg_dump 备份，备份文件仅存忽略目录。
4. 保持维护，分别执行 prisma migrate deploy；不能只升级一边，更不能 reset。核对两侧新增角色、权限、roleId 回填及原有业务内容。
5. 更新 backend、frontend、migrate 和 db-sync 镜像后启动。验证健康、空同步队列及新增 roles/role_permissions 一致；不重新运行主副本激活脚本。
6. 管理员重新登录 8088，在角色管理配置角色，再在账号管理分配。系统角色保护与版本冲突按 RBAC 说明执行。

所有业务登录与认证只走 PRIMARY，副本仅参与复制和维护，不是备用业务登录入口。角色配置及分配主库写，审计仅源库保存。同步失败保持队列并重试，不丢弃事件；两库升级不同步时保持维护。

本次 RBAC 验证与部署（2026-11-10）：259 项后端与 26 项浏览器测试、隔离迁移/旧数据保留/原子复制、构建/lint/格式检查通过；完成两库完整备份后部署迁移，原有数据与角色保留。新版前后端和同步桥健康，入口 8088 可见角色管理；两库角色与权限一致，所有旧会话需重新登录。已知非阻断界面细节记录在实施计划中。

统一登录更新（2026-11-10）：登录页仅使用用户名和密码，所有身份由后端识别；注册页的运营人员/管理员选择和公司内部 ID 规则保留。259 项后端及 28 项浏览器测试、构建/lint/格式检查通过；前端镜像已更新，8088 在线页面验收通过。本次不修改数据库和后端认证规则。

## 账号生命周期升级

迁移 `20261110070741_account_lifecycle` 为增量结构，不删除账号或业务数据；新增删除标记、独立审计与永久 UUID 墓碑，增加三个账号权限并扩充同步保护。先审阅 SQL、通过隔离回归，再进入维护窗口：停止业务写入、排空双侧队列、核对一致并停止同步桥；分别完整备份两库；两侧 `prisma migrate deploy` 后重建 backend/frontend/migrate/db-sync，确认健康、队列清空及原数据保留。保持用户自定义角色及原有授权，新增权限仅给系统 ADMIN。

不回滚删除迁移记录，不清除墓碑，不使用 reset 或删除数据卷。回滚应用前应保留维护并评估旧应用缺少停用校验的风险，不可直接运行不识别软删除的旧镜像。业务验收可用独立临时账号完成软删除→恢复→再次删除→无关联预检→硬删除；不要用真实同事账号作删除演示。

本次升级（2026-11-10）：266 项后端、30 项浏览器及隔离双库/迁移专项通过，构建、lint、格式通过。两库完整备份验证可读后分别部署迁移，原有 8 个账号、3 个角色、4 个商品、5 个订单以及明细/日志、原角色授权及凭证版本逐字段保留；新增 3 个权限只授予系统 ADMIN。backend/frontend/migrate/db-sync 镜像已更新，业务容器健康。

8088 在线 UI/API 已使用本次专用临时账号验证软删除、旧凭证/登录拒绝、恢复后重新登录、确认用户名后彻底删除及副本墓碑同步。临时账号已清理，必要审计/墓碑按设计保留。再次比较原数据通过，双侧同步队列为 0。
