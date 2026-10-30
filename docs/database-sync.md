# 本机与 Docker 数据库双向同步

本功能把本机 `localhost:5432/silk_shop` 与 8088 管理后台使用的 Docker `db/silk_shop` 连接起来。默认单库启动无需此功能；启用后，任一端对用户、分类、商品的新增、修改、删除都会传递到另一端，包含 Prisma Studio 与直接 SQL 操作。通常约 1–3 秒可见，查询工具需要刷新。

## 同步规则

- PostgreSQL 行触发器在业务事务内记录事件；后台进程每秒传递，目标提交后才确认。断线期间保留事件，恢复后重试，失败事件不会静默丢弃。
- 同一 UUID 的并发修改按数据库记录的修改时间决定，整行较新的版本胜出；时间相同按源数据库 UUID、事件 UUID 排序。请保持两台数据库时钟同步。它不是跨库强一致事务，两个页面短时间内可能看到不同数据。
- 用户名或邮箱唯一键冲突、外键冲突会保留双方数据与待处理事件。`23505` 表示唯一键冲突，`23503`/`23001` 表示关联约束冲突；人工修正业务冲突后自动重试。不要通过删除同步元数据消除报错。
- 删除保留版本标记，防止旧事件重新生成已删除记录。已成功传递的事件保留至少七天；删除版本标记长期保留。容量随写入量增长，需要日常监测。
- 不同步表结构、权限或数据库配置。每次结构变更仍需向两边分别执行 Prisma 迁移。禁止 `TRUNCATE` 和直接更改业务 UUID；使用正常 CRUD，避免绕过触发器。
- 数据库只保存 BCrypt 哈希，同步事件和备份包含哈希等私密数据，应按数据库本身保护；不要上传导出或日志里的完整事件内容。

## 首次配置

先配置 `backend/.env` 的本机项目库及根目录 `.env` 的 Docker 栈，确认容器可通过 `host.docker.internal:5432` 连接本机项目库。在根目录执行：

```powershell
node scripts/configure-sync.ts
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync build migrate db-sync backend
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync run --rm --no-deps db-sync node scripts/prepare-sync.ts
```

配置脚本把本机连接信息转为容器可访问地址，写入被忽略的 `.env.sync.local`，已有文件不覆盖。准备脚本短暂锁定两边业务表，将完整业务 JSON 备份保存到被忽略的 `tools/installers/sync-backups/`，不清空数据。跨库同名账号默认终止，需先明确选择合并方案。

本次用户已授权 `--merge-user=py666`：保留 Docker 账号的 UUID 和密码哈希，把本机同名账号的商品归属迁到该 UUID，保留本机其他账号和商品。仅在**首次同步迁移前**执行合并；备份是合并前快照。不要在已运行的同步库中重复做初始化合并。

准备完成后部署两边迁移并启动：

```powershell
npm.cmd --prefix backend run db:deploy
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync up -d --build --wait
```

迁移会按用户、分类、商品的依赖顺序将已有数据加入同步队列。另一台机器克隆代码后需配置自己的连接信息，不会获得本机凭据或数据。恢复数据时应先停止同步并分别保留双方备份，由维护者制定回放方案；不要直接把旧快照灌入正在同步的库。

## 查看状态与日常维护

启用后，启动、更新、停止均使用完整 Compose 参数：

```powershell
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync ps -a
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync logs --tail 40 db-sync
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync up -d --build --wait
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync stop
```

本机 PostgreSQL 与 Docker Desktop 都需要运行。同步进程会自动重连；成功双向处理后更新健康心跳，持续失败会显示 unhealthy。健康状态表示进程近期成功处理队列，确认数据一致请运行下面的核验脚本。

```powershell
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync exec db-sync node scripts/verify-sync.ts
# 可选：创建随机记录，验证双向增删改后自动清理，只用于开发环境
docker compose -f docker-compose.yml -f docker-compose.sync.yml --profile sync exec db-sync node scripts/verify-sync.ts --probe
```

脚本在内存比较三张完整业务表，仅输出数量和是否一致，不输出账号内容。队列排查可在两边分别执行以下只读 SQL；不要编辑 `_sync_identity`、`_sync_versions`、`_sync_events`：

```sql
SELECT table_name, last_error, count(*)
FROM _sync_events WHERE delivered_at IS NULL
GROUP BY table_name, last_error;
```

只停止同步可用 `... --profile sync stop db-sync`，期间两边继续独立写入，重新启动后会补传。迁移仍安装有捕获触发器，因此停用期间事件会累积。不要删除业务数据卷。

## 隔离自动验证

以下固定项目名仅用于测试，禁止替换成业务项目。测试要求两个空的临时数据库，包括账号合并与备份验证、迁移初始化、双向 CRUD、金额精度、并发更新、断线恢复、冲突保留、删除后旧事件回放与不支持操作的拦截。

```powershell
docker compose -p silk-shop-sync-test -f backend/test/docker-compose.sync-test.yml up -d --wait db-a db-b
docker compose -p silk-shop-sync-test -f backend/test/docker-compose.sync-test.yml run --build --rm tester
# 只删除专用测试项目及其临时数据；每次测试必须从空库开始
docker compose -p silk-shop-sync-test -f backend/test/docker-compose.sync-test.yml down --volumes
```
