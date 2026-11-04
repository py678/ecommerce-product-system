# 三角色权限与资源归属

## 权限矩阵

| 能力 | 访客 VIEWER | 运营人员 OPERATOR | 管理员 ADMIN |
| --- | --- | --- | --- |
| 商品列表/详情 | 全部 | 全部 | 全部 |
| 创建商品 | 无 | 当前账号为所有者 | 当前账号为所有者 |
| 修改/删除商品 | 无 | 自己 | 全部，保留原归属 |
| 分类读取 | 全部共享分类 | 全部共享分类 | 全部共享分类 |
| 分类写入 | 无 | 无 | 允许，引用中的分类不可删除 |
| 图片上传 | 无 | 允许 | 允许 |
| 个人中心 | 仅自己 | 仅自己 | 仅自己 |
| 账号列表/调整角色 | 无 | 无 | 允许，禁止自改角色 |

访客为已登录只读账号，不是匿名用户。已有账号迁移为运营人员，新注册强制访客。权限点：product:read/create/update/delete，category:read/create/update/delete，upload:image，user:read/assign-role。映射集中在 backend/src/auth/permissions.ts；前端消费后端 permissions，缺少权限信息默认拒绝。

## 安全边界

每次请求先验证 JWT/过期/tokenVersion，再从数据库角色检查权限。列表及 total 共用同一份筛选 where，并在 Repeatable Read 快照读取；所有登录角色共享列表和详情读取。更新/删除单独应用归属范围，实际写条件不丢失 userId。无操作权限 403；越权写入或资源不存在均 404。创建与编辑均不接受归属或角色赋值。全局 ValidationPipe 开启 whitelist/forbidNonWhitelisted/forbidUnknownValues；管理员角色 DTO 是唯一允许设置 role 的 HTTP 契约。

角色调整采用事务级 advisory lock，锁内复查操作者管理员身份，禁止自改、同角色写入及降级最后管理员；角色/版本增量/审计同时提交，任一失败全部回滚。旧 JWT 立即在当前认证库失效，前端下次请求 401 后清会话回登录。版本失效返回 SESSION_REVOKED，日志不输出请求 body 或凭据。

两库继续异步同步 role/token_version/password_hash。较低 token_version 的事件不能恢复较新角色或密码；历史无 role 事件按 OPERATOR 兼容。审计仅保留在操作发起库。两库同时管理角色仍沿用既有事件冲突规则，事务锁及最后管理员保护是单库保证；不要把双库当作跨库串行事务。

## 迁移与首次管理员

用户已审查确认两个迁移的完整 SQL。未执行 reset；本次只验证隔离 schema，不修改业务库，不启动业务服务器。

部署时先备份两库，保持应用和同步桥停止，分别部署两库结构迁移，再更新应用与同步桥代码，避免新桥访问旧结构。现有分类全局共享且没有用户归属字段，无需合并分类。

本机开发库（在 backend 目录、确认 .env 指向目标库）：

~~~powershell
npm.cmd run db:deploy
npm.cmd run build
npm.cmd run admin:bootstrap -- <已存在的用户名>
~~~

首次脚本只在该库没有管理员时工作，递增版本并写审计，不接收密码，不自动执行。指定哪个账号成为首位管理员需由维护者明确选择。启用同步时在主库运行一次，等待同步完成，不要两边分别选择不同账号初始化。

Docker 主库已迁移且代码镜像已更新后，可在根目录执行：

~~~powershell
docker compose run --rm --no-deps migrate node dist/admin/bootstrap-admin.js <已存在的用户名>
~~~

也可在已运行的 backend 容器执行同一路径。CLI 编译产物包含于现有 migrate 与 runtime 镜像，不依赖额外复制脚本或在运行容器安装开发依赖。

## 实现文件

| 范围 | 文件与作用 |
| --- | --- |
| 数据结构 | backend/prisma/schema.prisma；两个 20261104 迁移：角色、审计、已有用户回填 |
| 权限 | backend/src/auth/permissions.ts、permissions.guard.ts：权限映射、Swagger 元数据、默认拒绝 |
| 认证 | auth.service.ts、public-user.ts、dto/auth-response.dto.ts、auth.module.ts：数据库角色、公开权限、版本失效 |
| 商品 | products.controller.ts、products.service.ts：操作权限与实际查询/写入归属 |
| 分类与上传 | categories.controller.ts、upload.controller.ts：全局分类只读、管理员维护、上传权限 |
| 管理员 | backend/src/admin/*：账号分页筛选、角色事务、审计；app.module.ts 注册 |
| 资料与数据库 | users.service.ts 返回公开权限；database.service.ts 尊重连接 URL 的隔离 schema |
| 首次管理员 | backend/src/admin/bootstrap-admin.ts；package.json 新命令 |
| 双库 | scripts/sync/bridge.ts、prepare-sync.ts：传播角色与版本，旧事件防回退 |
| 前端基础 | src/auth/permissions.ts、RequirePermission.tsx、App.tsx、api/types.ts、client.ts、AuthProvider.tsx、session.ts：权限与 401/403 |
| 前端页面 | layouts/AdminLayout.tsx、pages/AdminUsersPage.tsx、ProductsPage.tsx、ProductDetailPage.tsx、CategoriesPage.tsx、AuthPage.tsx：导航、账号管理、权限按钮 |
| 测试 | backend/test/rbac*.ts、既有认证/商品/个人中心夹具、scripts/rbac-sync.integration.test.ts、sync.integration.test.ts；frontend/e2e/permissions.spec.ts 与既有回归 |
| 文档 | README、AGENTS、API、架构、数据库、部署及个人中心说明 |

## 本次验证（2026-11-04）

- 后端 10 个测试文件、218 项测试通过，包含权限默认拒绝、三角色矩阵、列表/总数同范围、越权 404、注册默认访客与敏感字段拒绝、角色变更使所有旧 token 失效、审计失败真实回滚、Swagger 契约。
- 浏览器 17 个场景已验证通过：全量运行中 16 项通过、1 项旧网络重试测试存在请求时序竞争；改为等待筛选与重试响应后，该场景单独重跑通过。覆盖新账号管理及权限控制，原有商品/分类/上传、中文搜索和个人中心流程。
- 前后端构建、ESLint、Prettier 通过；同步桥、初始化和相关测试脚本的独立 TypeScript 检查通过。
- 隔离 schema 空库完整迁移、已有账号回填、新账号默认值及 Prisma 无漂移检查通过；首次管理员 CLI、版本递增、审计和拒绝重复引导通过。
- 新增同步桥隔离回归通过：角色/版本双向传播、旧低版本事件无法恢复角色或密码、历史事件兼容。原有双物理实例同步套件及 Docker 镜像构建未重跑（Docker 引擎未运行）；本次未部署业务库或指定真实管理员。

所有测试使用独立 schema/随机账号；测试服务器执行后关闭，未启动业务服务器。

## 业务环境升级补充（2026-11-04）

此前“未部署业务库”的记录描述代码交付时状态；现已按维护者授权完成两库迁移、镜像更新和首次管理员设置，py666 为管理员，其余已有用户为运营人员。原密码保留，py666 原会话已撤销。两库角色与版本一致、同步队列清空，运行环境归属及权限检查通过。具体构建方式、备份和数据完整性验证见 [部署记录](deployment.md#三角色实际部署记录2026-11-04)。本次未新增其他业务功能。

## 登录入口与共享读取调整

登录页提供访客、运营人员、管理员三种身份选择。POST /api/auth/login 的可选 loginRole 仅核对已通过密码验证的数据库角色，不修改用户或授予权限；入口不匹配返回 401。省略该字段兼容原客户端。注册不接受角色选择，新账号仍固定访客。角色由管理员受控变更。商品读取向所有登录角色开放；运营人员仅可修改、删除自己的商品，访客仍不可写入。

本次调整验证：独立随机 schema 内后端 10 个文件、221 项测试通过；修正浏览器测试对隐藏原生 radio 的操作方式后，全量 22 个浏览器场景通过。前后端构建、ESLint、Prettier 通过。新版镜像已部署，运行库 py666 与 py667 均可读取全部 3 个商品；三角色入口、非所属商品只读、密码修改重新登录及既有上传/筛选流程均通过回归。未修改数据库结构或已有账号角色。
