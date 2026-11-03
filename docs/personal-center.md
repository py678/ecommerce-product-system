# 个人中心与凭证失效

首版功能：查看公开账号资料，仅编辑唯一邮箱；独立修改密码表单；基于 JWT tokenVersion 撤销全部旧会话。不新增昵称、头像、角色体系、缓存或 Redis。商品、分类、上传的业务逻辑不变，统一 Guard 的版本校验覆盖它们。

## 数据与认证

迁移 `20261103054143_user_token_version` 先以 `--create-only` 生成，SQL 与用户确认内容一致：

```sql
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
```

已在独立 PostgreSQL 中验证原用户全部旧字段不变、版本默认为 0、空库完整迁移和 schema 无漂移。禁止 reset。两套业务数据库须分别部署结构。

注册及登录从数据库取当前版本签入 JWT。Guard 先验签及有效期，再按 sub 查用户并比对版本；拒绝缺少版本、类型错误、非整数和负数等非法声明。只向 Controller 提供明确白名单的公开用户信息。注册/登录仍返回 accessToken；JWT payload 可解码，内部版本不是保密载荷，但个人中心响应与普通用户资料不返回它。后端不记录请求体、密码、哈希或完整凭证。

修改密码先 BCrypt 校验旧密码，再计算 cost 12 新哈希。事务中以 ID、读取的旧哈希、旧版本作条件更新，新哈希和版本递增一并成功；并发冲突拒绝覆盖。原密码错误不锁定账号，依赖每 IP 每分钟 5 次的接口限流。密码及邮箱规则见 [API 文档](api.md#个人中心)。

两库异步同步用户版本与哈希；新代码兼容历史事件没有版本时按 0 读取。应用较低版本事件时保留本库较高版本和对应哈希，防止旧资料快照恢复密码。两库同时改密仍沿用事件冲突规则，不提供跨库串行事务；一库修改后另一库在同步完成时撤销旧凭证。需要全局即时撤销时应统一认证数据源。

前端 `/profile` 两张表单独立提交，支持加载、字段错误、失败保留输入及重试。改密 200 成功或版本失效 401 后清理当前会话并跳登录，显示“密码已修改，请重新登录”。一般过期仍保持原提示；登录时允许返回个人中心。普通退出不递增版本。

## 变更文件

| 文件 | 作用 |
| --- | --- |
| backend/prisma/schema.prisma、prisma/migrations/20261103054143_user_token_version/migration.sql | 用户版本字段及数据保留迁移 |
| backend/src/users/users.module.ts、users.controller.ts、users.service.ts、dto/user.dto.ts | 独立个人中心模块、DTO、邮箱唯一冲突、改密事务及限流 |
| backend/src/auth/public-user.ts | 统一公开字段选择与安全映射 |
| backend/src/auth/auth.service.ts、jwt-auth.guard.ts | 注册/登录签入版本及每请求版本校验 |
| backend/src/app.module.ts | 注册个人中心模块 |
| backend/scripts/sync/bridge.ts、scripts/sync.integration.test.ts | 新字段传播、旧事件防回退与双库回归 |
| backend/test/users.spec.ts、users.e2e-spec.ts | 新增个人中心单元及 HTTP 安全测试 |
| backend/test/auth.e2e-spec.ts、catalog.e2e-spec.ts、product-filters.e2e-spec.ts、upload.e2e-spec.ts | 既有 JWT 测试夹具更新版本声明 |
| frontend/src/pages/ProfilePage.tsx、src/App.tsx、src/layouts/AdminLayout.tsx | 个人中心页面、路由与菜单 |
| frontend/src/api/client.ts | 个人中心 API 与复用 401 失效逻辑 |
| frontend/src/auth/session.ts、AuthProvider.tsx、auth-context.ts | 失效原因提示及资料更新后的账号状态 |
| frontend/src/pages/AuthPage.tsx | 登录后允许返回个人中心 |
| frontend/e2e/profile.spec.ts、profile-flow.spec.ts | 表单校验、200/401 会话清理及真实改密流程 |
| docs/api.md、database.md、deployment.md、architecture.md、personal-center.md、README.md | 接口、数据、部署与交付说明 |

## 验证

2026-11-03：后端 194 项单元/HTTP 测试、2 项数据库回归通过；双库同步 11 项测试通过；12 条浏览器流程通过，包含原有商品/分类/上传回归及中文输入回归。前后端构建、lint、Prettier 与变更同步脚本的独立 TypeScript 检查通过。首次两个加载态测试使用按钮完整可访问名称定位失败，改为匹配加载按钮并验证输入禁用后全量通过。

真实改密测试只操作隔离库的随机账号并自动清理；不修改现有业务用户密码。部署前备份两库，停止旧应用和同步进程，再分别迁移并更新镜像；升级后旧会话需重新登录。

同日已完成实际部署：本机与 Docker 库均应用该迁移；备份时未合并任何账号，保留 5 个用户、2 个分类、3 个商品。服务重新启动后健康检查通过，两库内容一致、同步队列为空；`/profile`、Swagger 与 OpenAPI 返回 200。上线只读验证确认合法新版凭证返回公开资料，缺少版本或版本不符均返回 401，未对现有用户执行改密。

## 个人中心 UI 调整（2026-11-03）

页面使用最大宽度 800px 的居中容器，个人资料和安全设置改为上下两张白色圆角卡片，间距 24px。资料只读区显示首字母头像、用户名及创建/更新时间，与邮箱编辑表单分开。安全设置保留会话失效提示及密码强度说明；所有输入框高 40px，标签加粗，两个提交按钮等宽。小于 768px 时缩小卡片内边距，按钮占满可用宽度。

样式集中在 `frontend/src/pages/ProfilePage.css`，仅调整 `ProfilePage.tsx` 展示结构和邮箱标签，并同步两份浏览器测试的标签定位；未修改 API、验证规则及提交处理逻辑。

本次前端构建、ESLint、Prettier 检查通过；3 条现有个人中心浏览器测试通过。使用模拟资料在 1440px 和 390px 视口验证卡片间距、输入高度、按钮等宽及无横向溢出。运行中的前端容器已更新。