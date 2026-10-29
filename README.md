# 电商商品管理后台

技术栈：NestJS、React、TypeScript、Ant Design、Prisma、PostgreSQL。
仓库：https://github.com/py678/git1

## 当前进度

已清理框架默认示例，建立用户、分类、商品数据库模型及迁移。认证、管理接口和业务页面按项目计划继续开发。

## 数据库开发

在 backend 目录使用 npm.cmd；首次配置、ER 图和约束说明见 [数据库文档](docs/database.md)。真实连接信息只存于被忽略的 backend/.env。

```powershell
cd backend
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:validate
npm.cmd run db:deploy
npm.cmd run db:verify
npm.cmd run start:dev
```

首次拉取需先根据 backend/.env.example 配置独立数据库；本地初始化流程见数据库文档。不要对已有业务库执行 reset。

## 开发约定

- 每个开发日提交并推送有效变更，使用 Conventional Commits，正文记录原因、变更和验证。
- 本仓库配置 .githooks/commit-msg；新克隆后执行 git config core.hooksPath .githooks。
- 首次成功推送后向周勇（Leo.Zhou）和黄锐（Bruce.Huang）发送仓库地址。
- 密码、令牌、node_modules、生成代码、构建产物和安装包不提交。
- 执行约定见 AGENTS.md 与 .cursor/rules/project.mdc；后续安排见项目计划.md。
