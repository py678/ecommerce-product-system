# 后端

NestJS + Prisma + PostgreSQL，使用 TypeScript / ESM。

环境准备与数据库设计见 [数据库文档](../docs/database.md)。在本目录执行 npm.cmd ci，然后配置 .env 并执行 npm.cmd run db:deploy。

常用命令：db:generate、db:validate、db:deploy、db:verify、build、start:dev、test:e2e。
注册登录、JWT 和当前用户接口已实现，启动前还需配置 JWT_SECRET（初始化脚本会生成）。访问 http://localhost:3000/docs 测试，详细配置见 [API 文档](../docs/api.md)。商品/分类 REST API 在下一阶段实现。
