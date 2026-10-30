# 答辩讲解提纲

配合 [演示脚本](demo.md) 使用。先理解实现和代码位置，再用自己的语言说明；开发辅助工具的使用应如实披露。

## 项目介绍（约一分钟）

项目是电商商品管理后台，包含注册登录、商品和分类管理。前端使用 React、Ant Design、React Router 与 Axios；后端使用 NestJS、JWT、Prisma 和 PostgreSQL。数据库保存用户、分类、商品，商品关联创建者和分类。Compose 统一启动数据库、迁移、后端及 Nginx 前端入口。

## 需要讲清楚的实现

| 话题 | 讲解要点 | 代码入口 |
| --- | --- | --- |
| 注册与登录 | DTO 验证输入，BCrypt cost 12 哈希密码；登录校验通过后签发 JWT，不返回密码哈希 | `backend/src/auth/` |
| 认证与权限 | Guard 校验 JWT 签名、有效期、issuer/audience 和用户存在性；商品修改/删除进一步检查创建者 | `backend/src/auth/`、`backend/src/products/` |
| 金额精度 | API 使用字符串，Prisma Decimal 和 PostgreSQL numeric(12,2) 保存，拒绝负数和超过两位小数 | `backend/src/products/`、`backend/prisma/schema.prisma` |
| 数据完整性 | 用户名/邮箱唯一，外键、RESTRICT 删除和 CHECK 约束防止非法数据；迁移记录版本化 | `backend/prisma/migrations/` |
| 列表查询 | 服务端分页、名称搜索、分类筛选；列表与总数在同一数据库快照读取，排序稳定 | `backend/src/products/`、`backend/src/categories/` |
| 前端会话 | Axios 带 Bearer 令牌；sessionStorage 保存当前标签页会话；刷新时请求 `/auth/me`；401 返回登录页 | `frontend/src/api/`、`frontend/src/auth/` |
| 用户反馈 | 表单验证、加载/空数据、操作成功提示、网络重试、删除确认；非创建者操作禁用 | `frontend/src/pages/`、`frontend/src/components/` |
| 容器启动 | 数据库健康后执行迁移，成功才启动 API；Nginx 代理 API 并提供 SPA 路由回退，数据保存在卷中 | `docker-compose.yml`、`frontend/nginx.conf` |
| 测试 | 真实 PostgreSQL 验证数据库约束，HTTP 测试验证输入与越权，Edge 测试验证真实页面流程 | `backend/test/`、`backend/scripts/`、`frontend/e2e/` |

## 常见追问

**为什么前端禁用按钮后，后端仍要检查权限？** 浏览器状态和请求都可被用户修改。前端限制用于提示，后端根据已验证的用户身份检查归属，数据库写入条件再次限定 userId。

**为什么不直接用 JavaScript number 保存价格？** 浮点数不能精确表达所有十进制小数。字符串传输与 Decimal/numeric 存储保留金额精度，前端仅格式化展示。

**重复注册和并发请求怎样处理？** 数据库唯一约束作为最终保证，应用将冲突转换为 409；HTTP 测试覆盖并发注册。

**删除分类为什么会失败？** 分类可能被任何用户的商品引用。前端提供提示，后端和数据库共同阻止删除，避免商品丢失分类。

**退出后 JWT 是否立即失效？** 当前退出清除浏览器令牌，服务端未实现撤销或刷新令牌，已签发令牌在有效期内仍有效；默认一小时。

**容器重建后数据在哪里？** PostgreSQL 数据保存在命名卷中。重建容器不删除卷，迁移表也保留；`down -v` 会删除卷，不能作为普通故障处理。

**目前哪些内容没有实现？** 分类树、角色分级、刷新令牌和在线部署未实现。分类由登录用户共享维护，商品仅创建者可修改；限流使用单进程内存。说明边界后，再介绍将来如何扩展。

## 演示前准备

本人完整走一遍注册、分类、商品、权限和删除流程；检查 Docker 健康及 Swagger；准备两个独立浏览器会话。确认实际答辩时间，并自行向周勇和黄锐发送仓库地址。不要用自动化测试通过代替本人的演示准备。
