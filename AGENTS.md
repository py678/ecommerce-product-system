# AGENTS.md — 面向 AI 协作代理的仓库约定

本文件面向在本仓库中协助开发的 AI 代理（如 Cursor、Copilot、Claude Code、DeepSeek 等），
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
- 打包下载的安装包可放入 `tools/` 但必须加入忽略规则，不提交到远程。

## 技术栈约定

- 全栈使用 **TypeScript**（除非依赖库本身为 JS）。
- 后端框架 **NestJS**，ORM 用 **Prisma**；数据库迁移用 `prisma migrate`。
- 密码必须 **BCrypt 哈希**存储，接口用 **JWT** 认证，敏感路由加 Guard。
- 前端 UI 用 **Ant Design**，路由用 **React Router**，请求用 **Axios**（统一封装拦截器），
  表单需做校验并有错误提示与用户反馈。
- API 文档启用并维护 **Swagger**。
- 版本选择稳定版，并核对对应 Node engines 与当前 Node 版本（v26.x）兼容。

## 代码规范

- 保持代码结构清晰、命名规范、注释充分且易于理解（评估标准之一）。
- 使用 **ESLint + Prettier** 保证风格一致；提交前尽量通过 lint/类型检查/单测。
- 无明显安全漏洞（输入校验、越权、明文密码等）与明显性能问题。
- 所有代码规范遵循 **Cursor Rules** 约定（见下）。

## Cursor Rules 接入

需求要求"所有的代码规范遵循 Cursor Rules 里的规范"。做法：

1. 在仓库根目录或每个子项目创建 `.cursor/rules/*.mdc`（Cursor 的 Rules 文件）。
2. 若项目使用 Cursor，其中规则会自动加载；即使不用 Cursor，也应把相等规范以
   `AGENTS.md` / `.cursorrules` 形式维护，保证一致性。
3. 本文件与 `.cursor/rules` 保持同步：本文件是总入口，Cursor rules 是工程化细则。

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