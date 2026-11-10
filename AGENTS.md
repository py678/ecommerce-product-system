# AGENTS.md — 面向 AI 协作代理的仓库约定

本文件面向在本仓库中协助开发的 Codex 及其他读取 AGENTS.md 的 AI 代理，
说明项目结构、技术栈、工作流与代码规范。人工开发者（INVESTIGATOR/维护者）也应遵守其中
与"考核评估"相关的硬性要求，因为它们直接决定交付质量。

## 权威来源

- 本文件是执行约定；与需求冲突时以需求为准，并在此同步更新。

## 项目概述

电商后台管理系统（无前台，仅后台管理）：

- 后端：NestJS + Prisma ORM + PostgreSQL + JWT + Swagger
- 前端：React + Vite + TypeScript + Ant Design + React Router + Axios
- 版本控制：Git + GitHub（远程 `https://github.com/py678/ecommerce-product-system.git`，默认分支 `main`）

## 目录结构

```
backend/      NestJS 应用（src/、prisma/、test/ 等）
frontend/     React + Vite 应用（src/、vitest 等）
docs/         交付文档（架构说明、API、数据库设计、部署指南）
.agents/skills/   Codex 按任务使用的项目技能
docker-compose.yml   同时启动 PostgreSQL 与后端（必要时含前端）
README.md     项目总入口说明
AGENTS.md     本文件
```

新增模块/文件时保持目录结构化，避免在根目录堆积散乱文件。

## Workspace 与任务编排

- 使用 npm workspaces（backend、frontend）与 Turborepo；根目录统一执行 `npm ci`，只维护根目录 package-lock.json，不在子目录新增锁文件。
- 根目录 `npm run build`、`npm run lint`、`npm run format:check` 为统一检查入口；`npm test` 为隔离后端验证，`npm run test:orders` 包含隔离浏览器回归。任务图负责构建先后，直接调用子目录测试脚本前须准备构建。
- Prisma Client 生成不缓存且先于后端构建；数据库、双库、浏览器测试和格式写入禁用缓存。迁移、管理员引导、同步和 Docker 部署须显式执行，不挂到默认 build/dev。
- 仅启用本地缓存，`.turbo`、生成客户端与构建产物均不提交。调整构建输入、环境变量或输出路径时配套更新 turbo.json。详情见 docs/tooling.md。

## 版本控制（硬性要求）

- 每个开发日均需提交并推送；无变更时不创建空提交。
- 提交遵循 **Conventional Commits**：`type(scope): 描述`，正文写明原因/变更/验证。
  允许类型：`feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`。
- 提交信息（subject + body）建议使用中文或英文均可，但类型关键字必须英文且符合规范。
- 仓库已配置 `.githooks/commit-msg` 校验提交信息，提交前应满足该校验。
- 认证使用 Git Credential Manager / SSH，**绝不把访问令牌写进任何仓库文件或数据库凭据**。
- 私有凭据（如数据库密码、JWT 密钥）放在 `.env*`，并确保被 `.gitignore` 排除。
- 密码、令牌、依赖目录、生成代码和构建产物不得提交；不含真实凭据的 `.env.example` 与依赖锁文件应提交。
- 打包下载的安装包可放入 `tools/` 但必须加入忽略规则，不提交到远程。

## 技术栈约定

- 全栈使用 **TypeScript**（除非依赖库本身为 JS）。
- 后端框架 **NestJS**，ORM 用 **Prisma**；数据库迁移用 `prisma migrate` 并入库。禁止 `prisma migrate reset`，不得擅自删除已有业务数据；新迁移必须先用 `--create-only` 生成并审查 SQL，具体流程见 `prisma-migration-safe` 技能。
- 密码必须 **BCrypt 哈希**存储，接口用 **JWT** 认证，敏感路由加 Guard。
- 前端 UI 用 **Ant Design**，路由用 **React Router**，请求用 **Axios**（统一封装拦截器），
  表单需做校验并有错误提示与用户反馈。
- API 文档启用并维护 **Swagger**。
- 版本选择稳定版，并核对对应 Node engines 与当前 Node 版本（v26.x）兼容。

## 角色与资源范围

- 可配置角色：用户通过 roleId 关联单一角色，角色授予固定目录权限和按操作的 OWN/ALL 数据范围。默认预置 OPERATOR（运营人员）、ADMIN（管理员），旧 role 列仅作兼容，不作为授权依据。注册默认运营人员；选择管理员注册时，必须由后端验证私有配置中的公司内部 ID。已有账号角色只通过受控管理员接口/首次引导脚本修改。
- 默认运营人员和管理员均可查看全部商品；默认运营仅管理自己的商品/订单，管理员管理全部。自定义角色按 read/write 权限与 OWN/ALL 范围执行；分类全局共享，维护及上传取决于对应权限点。个人中心仅当前用户。
- 敏感接口同时执行 JWT、权限点 Guard 与 Service 数据范围校验。商品列表和总数必须共用同一筛选 where，默认共享读取不限制创建者，自定义 OWN 读取附带归属；实际更新/删除条件按对应操作范围执行。越权与不存在统一 404。
- ADMIN 系统角色不可修改、停用或删除；默认 OPERATOR 不可停用或删除。不能修改自己所属角色、越级授予权限或删除有用户角色。角色配置/分配仅主库写入，事务内复核授权并记录审计；配置变更递增关联用户 tokenVersion，撤销 HTTP/Socket 凭证；业务认证拒绝 REPLICA。详见 docs/rbac.md。
- 所有 DTO 严格白名单；普通业务接口拒绝 role/userId/creatorId 等非契约字段；注册 DTO 仅允许显式 role 和只写 companyId，管理员注册必须验证 companyId，不能直接信任 role。角色修改使用独立 DTO，事务内递增目标 tokenVersion 并写审计，禁止自改角色及降级最后管理员。

## 订单与库存范围

- 账号生命周期：软删除/恢复只在主库操作，事务内递增 tokenVersion 并保留审计，撤销 HTTP/Socket 会话。禁止自删及删除最后有效管理员；硬删除须系统 ADMIN 与 user:purge，且目标已软删除、无任何商品和订单，不级联业务数据。永久 UUID 墓碑防止延迟同步复活；同步生命周期使用独立主库版本，不被副本资料时间戳覆盖。详见 docs/account-lifecycle.md。

- 后台代客录单；运营仅访问自己的订单，管理员全部。确认由创建人或管理员手动触发。已发货/已完成不得取消，库存不回补；首版无支付、退款和退货。
- 订单、明细、库存与日志同事务；幂等与状态锁防止重复扣补。手动修改库存必须携带 stockVersion，过期409；订单引用的商品不可删除。
- 双库部署中 Docker 为 PRIMARY，本机为 REPLICA：商品和订单单主写入，用户/分类继续双向同步。副本不直写商品/订单，复制按源事务整体应用，不重新执行库存逻辑。升级须先备份、排空旧队列并核对一致性。
- 订单事件只发创建人/管理员，禁止广播客户信息。规格及验收见 docs/orders.md。

## 代码规范

- 保持代码结构清晰、命名规范、注释充分且易于理解（评估标准之一）。
- 使用 **ESLint + Prettier** 保证风格一致。
- 接口必须校验输入；涉及归属的资源操作必须检查当前用户权限，避免越权、明文密码等安全漏洞及明显性能问题。
- 提交前根据变更范围检查构建、lint、类型及相关测试，如实记录已通过、失败和未执行的验证，不把历史结果当作本次结果。
- 全局约定以本文件为入口，具体任务流程使用下列 Codex Skills。

## Codex Skills 接入

团队已转用 Codex；全局底线由本文件统一维护，不再依赖 Cursor Rules。技能位于 `.agents/skills/`，仅在相关任务触发时读取对应 `SKILL.md`，无需每次加载全部技能：

| 任务 | 技能入口 |
| --- | --- |
| 修改 Prisma schema、生成或部署迁移、处理迁移失败 | [.agents/skills/prisma-migration-safe/SKILL.md](.agents/skills/prisma-migration-safe/SKILL.md) |
| 新增或修改 NestJS 资源查询、更新、删除的归属逻辑 | [.agents/skills/nestjs-resource-ownership/SKILL.md](.agents/skills/nestjs-resource-ownership/SKILL.md) |
| Controller、DTO 或认证/响应契约变更 | [.agents/skills/swagger-sync/SKILL.md](.agents/skills/swagger-sync/SKILL.md) |
| React/Ant Design 表单、提交反馈及后端字段错误处理 | [.agents/skills/frontend-form-feedback/SKILL.md](.agents/skills/frontend-form-feedback/SKILL.md) |

技能只细化任务步骤，不替代本文件的全局要求，也不授予额外操作权限。无需修改对应业务代码的规则维护任务，不触发业务实现或数据库操作。

## 文档（交付物）

发布或格式提交时配套维护：

- 架构说明
- API 文档（以 Swagger 为准，docs/ 提供使用说明）
- 数据库设计（ER 图 + 表结构描述）
- 部署指南与本地启动步骤

## 每日提交流程（供代理遵守）

```bash
git status          # 查看变更
git diff            # 审查差异
# 运行相关检查（lint / 类型检查 / 测试）
git add <文件>
git diff --cached   # 确认暂存内容
git commit -m "type(scope): 描述" -m "原因：… 变更：… 验证：…"
git push            # 推送到 GitHub
```

首次配置与首次推送说明见 README.md。
