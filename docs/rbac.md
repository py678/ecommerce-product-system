# 可配置角色、权限与数据范围

## 使用流程

1. 使用系统管理员（当前 py666）登录后台，打开「角色管理」。
2. 新增角色，填写唯一编码、名称和说明，勾选权限。编码使用 2～32 位大写字母、数字、下划线，以字母开头，创建后不可修改。
3. 对商品、订单的查看或操作权限选择「仅本人 OWN」或「全部数据 ALL」。非归属资源（分类、上传、账号、角色）使用 ALL。
4. 打开「账号管理」，找到账号，选择「调整角色」，从启用的角色中选择。每个用户只能属于一个角色。
5. 目标账号所有旧凭证失效，重新登录后获取新角色权限。所有角色统一使用用户名和密码登录；后端自动识别角色，不需选择登录身份。

角色可以只配置查看权限，也可以不配置任何业务权限（仅使用自己的个人中心）。未授权的菜单与按钮隐藏；直接请求接口依然由后端拒绝，前端隐藏不是安全边界。

## 默认角色与兼容

| 能力 | 默认运营人员 OPERATOR | 系统管理员 ADMIN |
| --- | --- | --- |
| 商品列表/详情 | 全部 | 全部 |
| 创建商品 | 自己创建 | 自己创建 |
| 商品修改/删除 | 仅本人 | 全部 |
| 订单列表、详情、状态操作 | 仅本人 | 全部 |
| 分类读取/写入 | 可读，不可写 | 可读写 |
| 上传图片 | 允许 | 允许 |
| 账号与角色管理 | 无 | 允许 |

上述为迁移后的初始配置，非硬编码授权。ADMIN 为安全保留角色，不可编辑、停用、删除；默认注册角色 OPERATOR 不可停用或删除，管理员可调整其权限。自定义角色不自动获得任何能力，不新增示例业务角色。

注册继续支持原有 OPERATOR / ADMIN；管理员注册必须通过后端私有公司内部 ID 校验，自定义角色只能由受控分配接口授予。旧 users.role 枚举保留用于兼容，真正权限来源是 users.role_id → roles → role_permissions。公开用户响应提供 role（角色编码）、roleId、roleName、permissions、dataScopes，不返回哈希和 tokenVersion。

## 固定权限目录

- 商品：product:read/create/update/delete；read、update、delete 可配置 OWN/ALL，create 固定 ALL（创建者仍固定为当前用户）。
- 分类：category:read/create/update/delete，全局共享，固定 ALL。
- 订单：order:read/create/confirm/ship/complete/cancel；除 create 外均可配置 OWN/ALL。
- 上传：upload:image，固定 ALL。
- 账号：user:read、user:assign-role，固定 ALL。
- 角色：role:read/create/update/delete，固定 ALL。

权限目录共 21 项，由代码和迁移维护，不支持通过前端增加任意权限字符串。写操作必须同时授予对应资源的 read；创建商品需要 category:read，创建订单需要 product:read；ALL 写入需要同资源 ALL 读取。选错组合返回 400，不会自动扩大权限。

## 后端安全边界

JWT 校验签名、过期和 tokenVersion，读取有效角色和 grants；停用角色拒绝登录及现有会话。PermissionsGuard 缺少权限声明或权限不足默认拒绝。商品、订单在 Service 内使用按操作配置的 scope：列表与总数共用同一 where，详情与实际写条件同样限制归属。越权与不存在统一 404，无操作权限返回 403。

所有 DTO 开启 whitelist、forbidNonWhitelisted、forbidUnknownValues；业务 DTO 拒绝 roleId/role/userId/creatorId 等非契约字段。角色接口只接受明确字段，grants 不可重复；账号分配只接受 roleId（旧 role 编码兼容，二者只能传一个）。

角色配置和分配共享事务锁，并在锁内重新读取操作者权限。不能改自己的角色或自己所属角色，不能授予超出自身权限/范围的能力，不能借改配置提升已有高权角色。只有系统管理员可授予或调整系统管理员账号，禁止降级最后管理员。

角色权限、名称或状态更新会递增角色 version 和所有关联用户 tokenVersion；账号分配递增目标用户 tokenVersion。权限/分配/审计同事务提交；角色更新携带 version，冲突 409。提交后断开受影响 Socket 会话，旧 HTTP 凭证返回 401。实时商品和订单通知按 read 权限及范围发送，事件不包含客户信息。

删除仅允许无关联用户的自定义角色。有用户返回 409，应先重新分配账号。审计包含操作者、角色、时间、动作、配置前后快照；角色删除后审计仍保留。系统不提供删除审计的 HTTP 接口。

## 数据与同步

迁移 `20261110023925_configurable_rbac` 新增 roles、permissions、role_permissions、permission_audits，以及 users.role_id；保留原角色列与全部业务数据。现有账号按原角色关联默认角色，tokenVersion +1，升级后所有账号必须重新登录。角色审计编码长度扩为 32，保留历史原文。

角色配置、分配仅允许在 Docker PRIMARY（隔离开发为 STANDALONE）修改。新增 roles/role_permissions 同步与禁止 TRUNCATE 触发器，副本禁止直接改角色配置和分配。roles、grants 和关联用户版本随源事务整体复制，失败不部分应用。副本资料事件即使更晚，也不能覆盖主库的角色分配。

用户/分类仍双向同步，商品/订单仍单主；权限审计和原角色审计只保存在操作源库。业务登录及 JWT 认证拒绝 REPLICA，避免复制延迟形成绕过撤权的备用入口。展示和操作统一经 8088 主服务；副本不作为独立业务后台。

## 验证与维护

- `npm test`：随机隔离 schema 上运行迁移、数据保留/角色原子同步、后端单测及 HTTP 测试。
- `npm run test:orders`：上述检查加全部浏览器流程，包括角色创建、动态分配、范围按钮和无资源权限落地页。
- 对应代码：backend/test/roles.e2e-spec.ts、backend/test/rbac*、backend/scripts/configurable-rbac.integration.test.ts、frontend/e2e/roles.spec.ts、frontend/e2e/permissions.spec.ts。

部署步骤见 [部署指南](deployment.md)。不要修改已部署的历史迁移，禁止 reset、删除卷或丢弃同步事件。
