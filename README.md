# 电商商品管理后台

技术栈：NestJS、React、TypeScript、Ant Design、Prisma、PostgreSQL。
仓库：https://github.com/py678/git1

## 当前进度

已完成数据库、注册登录、JWT、商品/分类 CRUD、分页搜索、Swagger、React 管理页面和 Docker Compose 联合启动。Linux 容器内 79 项接口测试、2 项数据库测试及通过 Nginx 入口的 3 组 Edge 浏览器回归通过。

前后端启动后访问 [管理后台](http://localhost:5173)，首次使用自行注册账号。商品可共享查看，仅创建者可修改和删除；分类由所有成员共享维护。本地配置、验证及生产部署注意事项见 [启动指南](docs/local-start.md)。

容器启动：在根目录执行 `node scripts/setup-compose.ts`、`docker compose up -d --build`，访问 http://localhost:8088。需要已运行的 Docker Linux 引擎；完整步骤与数据维护见 [Docker 部署指南](docs/deployment.md)。容器数据库与本机开发数据库独立。

后端启动后访问 [Swagger](http://localhost:3000/docs)，注册登录并授权后即可测试分类、商品管理。配置与接口详情见 [API 文档](docs/api.md)，模块说明见 [架构文档](docs/architecture.md)。

## 交付材料

- [验收清单与验证记录](docs/acceptance.md)
- [功能演示步骤](docs/demo.md)
- [答辩讲解提纲](docs/defense-notes.md)
- [数据库设计与 ER 图](docs/database.md)

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
