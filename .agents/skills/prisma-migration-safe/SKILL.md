---
name: prisma-migration-safe
description: 修改 Prisma schema、生成或部署 PostgreSQL 迁移、处理迁移失败时，执行 SQL 先审查、保留现有数据的迁移流程。
---

触发条件：任务涉及 Prisma 表结构、迁移文件或迁移部署。

1. 读取 schema、已有迁移和数据库文档，确认目标数据库、影子库及当前迁移状态；不输出连接凭据。影子库必须与业务库分离。
2. 修改模型后先执行 `npm.cmd run db:validate`。新迁移只在开发库使用 `npx.cmd prisma migrate dev --name change_description --create-only` 生成，禁止跳过 SQL 审查直接应用模型变更。
3. 审查 SQL 的 DROP、TRUNCATE、列类型/非空变更、唯一键、外键、默认值及数据回填。保留现有 CHECK、索引和同步触发器；有丢失数据风险时先制定备份、回填与恢复方案，不擅自执行破坏性操作。
4. 在隔离测试库应用审查后的迁移，验证已有数据、约束与 Prisma 读写；确认迁移与模型无漂移。禁止 `prisma migrate reset`，不得以 `db push --accept-data-loss` 绕过审查，不修改已应用迁移来掩盖问题。
5. 在任务授权的目标库使用 `npm.cmd run db:deploy` 应用审查后的迁移，再检查状态和相关测试。双向同步只传业务数据，两边仍需分别部署结构迁移；失败时停止后续部署，排查状态，不清空业务库重试。
6. 提交 schema、迁移 SQL、相应数据库文档及真实验证结果；不提交备份、连接信息或生成的 Prisma Client。
