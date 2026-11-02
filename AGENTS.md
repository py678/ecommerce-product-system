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
