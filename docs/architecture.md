# 项目架构

后端采用 NestJS 模块结构，使用 TypeScript / ESM；通过 Prisma PostgreSQL adapter 连接数据库。前端暂保留 React / Vite 骨架，后续实现 Ant Design 管理界面。

```mermaid
flowchart LR
  UI[React 管理后台 / Swagger] --> HTTP[NestJS HTTP API]
  HTTP --> Limit[请求限流]
  Limit --> Validation[DTO 输入验证]
  Validation --> Auth[认证模块]
  Auth --> BCrypt[BCrypt 密码哈希与校验]
  Auth --> JWT[JWT 签发与校验]
  Auth --> DB[DatabaseService / Prisma]
  DB --> PG[(PostgreSQL)]
```

- `DatabaseModule`：管理 Prisma 生命周期，启动连接、关闭时释放连接池。
- `AuthModule`：注册、登录、当前用户；导出 JWT Guard，供后续商品与分类接口保护。
- `configure-app.ts`：统一 `/api` 前缀、DTO 验证、CORS 和 Swagger，并与集成测试共用配置。
- `prisma/`：schema 与版本迁移；开发迁移使用独立影子库。
- `test/`：真实数据库 HTTP 测试；`scripts/`：建库及底层数据库约束验证。

真实密码和密钥只存在本地 `.env`。用户查询显式选择公开字段；JWT 只包含用户标识、签发时间、有效期及系统标识。默认请求限流使用单进程内存，不适用于共享多实例计数。

当前阶段不包含商品/分类业务 API 和前端管理页面；部署与完整系统回归在对应阶段补齐。
