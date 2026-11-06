# ecommerce-product-system — 电商商品管理后台

技术栈：NestJS、React、TypeScript、Ant Design、Prisma、PostgreSQL。
仓库：https://github.com/py678/ecommerce-product-system

## 当前进度

已完成商品/分类、注册登录、个人中心、两角色权限、图片上传、筛选排序与 Socket.IO。新增后台订单：录单扣库存、幂等重试、手动确认/发货/完成、取消回补与操作记录；库存使用单主与整事务复制。测试方式见订单规格与部署指南。

前后端启动后访问 [管理后台](http://localhost:5173)，首次使用自行注册账号。所有登录角色均可查看全部商品；运营人员仅管理自己的商品，管理员管理全部商品；分类全局可读，仅管理员维护。新注册默认运营人员，也可选择管理员并验证公司内部 ID。本地配置、验证及生产部署注意事项见 [启动指南](docs/local-start.md)。

容器启动：在根目录执行 `node scripts/setup-compose.ts`、`docker compose up -d --build`，访问 http://localhost:8088。需要已运行的 Docker Linux 引擎；完整步骤与数据维护见 [Docker 部署指南](docs/deployment.md)。通过 `docker-compose.sync.yml` 启用双库同步；订单版本中商品/订单仅 Docker 主库写入，本机为只读副本，用户/分类保持双向。旧双向部署升级须先按订单部署说明完成备份、排空队列与角色切换。

后端启动后访问 [Swagger](http://localhost:3000/docs)，注册登录并授权后即可测试分类、商品管理。配置与接口详情见 [API 文档](docs/api.md)，模块说明见 [架构文档](docs/architecture.md)。

## 交付材料

- [数据库设计与 ER 图](docs/database.md)
- [商品图片上传：接口、部署与完整文件清单](docs/product-images.md)

## 数据库开发

所有依赖在仓库根目录统一安装，使用 npm workspaces + Turborepo；不再在前后端分别执行 npm ci。首次配置、ER 图和约束说明见 [数据库文档](docs/database.md)。真实连接信息只存于被忽略的 backend/.env。

```powershell
npm.cmd ci
npm.cmd run db:generate --workspace backend
npm.cmd run db:validate --workspace backend
npm.cmd run db:deploy --workspace backend
npm.cmd run db:verify
npm.cmd run dev
```

首次拉取需先根据 backend/.env.example 配置独立数据库；本地初始化流程见数据库文档。不要对已有业务库执行 reset。

## 统一开发命令

根目录执行 `npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run format:check`。`npm.cmd test` 执行隔离后端测试，`npm.cmd run test:orders` 构建两端并执行隔离后端及浏览器回归；数据库与浏览器测试始终实际执行，不使用缓存。仅前端开发可用 `npm.cmd run dev --workspace frontend`，默认代理 Docker 8088。双库业务模式不通过本机副本后端写商品/订单。

本地缓存策略、单应用命令、Docker 及排错见 [Workspace 与 Turborepo](docs/tooling.md)。

## 开发约定

- 每个开发日提交并推送有效变更，使用 Conventional Commits，正文记录原因、变更和验证。
- 本仓库配置 .githooks/commit-msg；新克隆后执行 git config core.hooksPath .githooks。
- 首次成功推送后向周勇（Leo.Zhou）和黄锐（Bruce.Huang）发送仓库地址。
- 密码、令牌、node_modules、生成代码、构建产物和安装包不提交。
- 全局执行约定见 [AGENTS.md](AGENTS.md)；Prisma 迁移、NestJS 归属、Swagger 同步和前端表单流程由 [.agents/skills/](.agents/skills/) 下的 Codex Skills 按任务加载；后续安排见项目计划.md。

## 商品筛选与排序

名称、分类、闭区间价格、库存组合筛选，支持排序、URL 条件恢复和 300ms 防抖。参数兼容、文件清单与部署说明见 [商品筛选与排序](docs/product-filters.md)。

## 角色权限

已实现两角色权限点、后端 Guard 与资源归属、管理员账号管理和角色变更撤销旧会话。首次管理员需受控脚本设置；迁移、权限矩阵与部署步骤见 [角色权限说明](docs/rbac.md)。

## 个人中心

登录后从菜单进入个人中心，可查看资料、编辑邮箱和修改密码；改密后所有旧会话需重新登录。升级后的首次访问也需重新登录。规则、迁移和文件清单见 [个人中心说明](docs/personal-center.md)。

## 实时通知

已接入 Socket.IO：商品/分类变更后自动刷新，连接状态可见，重连补拉、300ms 合并和会话撤销。需要重建前后端镜像。事件契约、启动命令、双浏览器验证与文件清单见 [实时通知规格](docs/realtime.md)。

## 后台订单

登录后进入“订单管理”。创建立即扣库存，由创建人或管理员手动确认；已发货订单禁止取消且不回补库存。订单历史快照保留，关联商品禁止删除。业务规则、验收和启动步骤见 [订单规格](docs/orders.md)。
