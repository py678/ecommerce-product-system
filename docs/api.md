# API 使用说明

基础地址：`http://localhost:3000/api`。
Swagger 页面：`http://localhost:3000/docs`；OpenAPI JSON：`http://localhost:3000/docs-json`。

## 图片上传与商品封面

`POST /upload/image`（含全局前缀的完整路径为 `/api/upload/image`），需要 Bearer JWT，使用 `multipart/form-data`，唯一文件字段为 `file`。单文件最多 5 MiB（5 × 1024 × 1024 字节），仅接受 jpg/jpeg/png/webp；后端核对扩展名、MIME 与文件签名，使用 UUID 重命名保存到后端工作目录的 `./uploads`。

成功返回 HTTP 200：

```json
{ "code": 0, "message": "ok", "data": { "url": "/uploads/96c01d96-53f3-4fb8-b761-923ab8fae3fe.png" } }
```

缺少/无效 JWT 返回 401；缺少文件、类型不合法、多文件或错误字段返回 400；超出大小限制返回 413。返回的 `/uploads/**` 图片可直接访问，无需登录，请勿上传私密文件。

商品创建/更新接受可选字符串 `coverImage`：上传返回的 `/uploads/UUID.ext` 相对路径，或合法的 HTTP(S) URL（最长 2048 字符）；不传该字段时保留已有值，传空字符串明确清空封面，非法 URL、非字符串和请求中的 `null` 返回 400。商品响应始终包含 `coverImage: string | null`。清空或替换封面不会删除服务器文件，原有 CRUD、价格、库存和权限规则保持不变。

## 认证接口

| 方法与路径 | 请求 | 成功结果 |
| --- | --- | --- |
| POST /auth/register | username、email、password | 201；用户资料与访问令牌 |
| POST /auth/login | username、password | 200；用户资料与访问令牌 |
| GET /auth/me | Authorization: Bearer <accessToken> | 200；当前用户资料 |

在 Swagger 展开接口，点击 Try it out 填写请求；注册/登录成功后，复制响应中的 `accessToken`，在页面的 Authorize 中粘贴令牌即可调用 `/api/auth/me`。不要把令牌粘贴到提交记录或文档。

注册示例：

```json
{
  "username": "silk_demo",
  "email": "demo@example.com",
  "password": "Use-your-own-password-123!"
}
```

用户名去除首尾空白，长度 3–64 字符，允许字母（含中文）、数字、下划线和连字符，区分大小写。邮箱去除首尾空白并转小写，最长 254 字符。密码至少 8 字符、最多 72 UTF-8 字节，不允许全空白，不做 trim，使用 BCrypt cost 12 存储。请求不得携带额外字段，例如 `isAdmin`。

认证响应字段：`accessToken`、`tokenType`（Bearer）、`expiresIn`（秒）、`user`。用户资料仅包括 `id`、`username`、`email`、`createdAt`、`updatedAt`，不会返回密码或哈希。注册后自动登录，令牌默认有效一小时。

| 状态码 | 含义 |
| --- | --- |
| 400 | 缺失/非法字段或额外字段；message 通常为验证消息数组 |
| 401 | 用户名或密码错误；令牌缺失、错误、过期，或对应用户已删除 |
| 409 | 用户名或归一化邮箱重复，并发注册也受数据库唯一约束保护 |
| 429 | 注册超过每分钟 5 次或登录超过每分钟 10 次；按客户端地址及接口计数，含失败请求 |

错误使用 Nest 标准 JSON：`statusCode`、`message`、`error`。登录失败对未知账号和错误密码统一提示。限流为单进程内存存储，重启后清空；多实例部署时需更换共享存储。本项目目前使用本机直连，不信任客户端自行提供的转发地址头。

JWT 使用 HS256，只接受匹配本系统 issuer/audience、包含有效用户 ID、有效期及整数 tokenVersion 且签名正确的令牌。验证签名和有效期后，每次鉴权直查数据库确认用户仍存在且版本相同。注册自动登录和普通登录均签发当前版本；缺少版本的历史令牌直接返回 401，升级后原有会话需重新登录。版本不匹配时返回 401，message 为“密码已修改，请重新登录”。目前不加缓存或 Redis。

尚无刷新令牌或普通登出的服务端撤销；普通退出仍仅删除客户端凭证。修改密码会在同一事务中更新 BCrypt 哈希并递增版本，撤销当前及其他旧会话。用户资料响应始终不含密码、哈希或版本字段；登录/注册响应中的 accessToken 仍是必要凭证，其 JWT payload 按设计可解码并含版本，日志不得记录完整凭证。

## 个人中心

以下路径均包含全局 `/api` 前缀，必须提供 Bearer JWT。用户 ID 仅取自已验证凭证，不接受任何查询参数；请求 body 通过 DTO 白名单验证，额外字段返回 400。

| 方法与路径 | 请求 | 成功响应 |
| --- | --- | --- |
| GET /users/me | 无 | 200；id、username、email、createdAt、updatedAt |
| PATCH /users/me | `{ "email": "new@example.com" }` | 200；更新后的公开资料 |
| PATCH /users/me/password | `{ "oldPassword": "Original-password-123!", "newPassword": "Changed-password-456!" }` | 200；`{ "message": "密码已修改，请重新登录" }`，不返回新凭证 |

邮箱是首版唯一可编辑字段，去除首尾空白并转小写，最长 254 字符，必须为合法邮箱；数据库唯一约束冲突（含并发冲突）返回 409。username、role、status、password、passwordHash、tokenVersion、userId、nickname、avatar 等不在资料更新白名单中，空 body 返回 400。

原密码不 trim，沿用登录校验（至少 8 字符、最多 72 UTF-8 字节）；BCrypt 比较不匹配统一返回 400“原密码错误”，不锁定账号。新密码 8–32 字符、最多 72 UTF-8 字节，至少包含一个英文字母和一个数字，不 trim，且不得与原密码相同；违反规则返回 400。原有注册/登录密码强度约定不变。

改密接口每 IP 每分钟最多 5 次，包含失败请求，超限 429；成功时在事务内同时写新哈希和递增版本，并以旧哈希/旧版本作为并发写条件，避免同时改密相互覆盖。所有个人中心响应带 `Cache-Control: no-store`。

前端导航“个人中心”位于 `/profile`，含资料与密码两张表单。改密成功清除当前会话并跳登录页，提示“密码已修改，请重新登录”；后续请求因版本不符收到 401 时复用同一会话过期机制，普通过期仍使用原有通用提示。当前为 sessionStorage，其他标签页/会话在下一次受保护请求时失效。

两库采用异步双向同步：改密在当前数据库立即撤销旧凭证，在另一库同步完成后撤销。同步用户版本和密码；较旧版本的事件不得覆盖新版本或新哈希。不保证两套库同时改密时的全局串行化，需此保证时应统一认证数据源。详细实现与升级步骤见 [个人中心说明](personal-center.md)。

## 启动配置

在 `backend/.env` 配置：

- `DATABASE_URL`：真实项目数据库连接。
- `JWT_SECRET`：自行生成至少 32 随机字节的密钥，建议保存为 64 位十六进制字符串。不设默认密钥，缺失或过短时启动失败。
- `JWT_EXPIRES_IN_SECONDS`：60–86400 的整数，默认 3600。
- `FRONTEND_ORIGIN`：允许跨域的前端来源，默认 `http://localhost:5173`。
- `PORT`：默认 3000。
- `LOW_STOCK_THRESHOLD`：全局正整数，范围 1–2147483647，默认 6；`zero` 为 `stock = 0`，`low` 为 `stock > 0 且 stock < 阈值`，`normal` 为 `stock >= 阈值`。非法配置阻止应用启动。

新的数据库初始化脚本会自动生成 JWT 密钥。本机现有 `.env` 也已补充随机密钥。不要覆盖 `.env`，不要将真实密钥提交到 Git。

执行 `npm.cmd run start:dev`，打开 Swagger 测试。`npm.cmd test` 包含数据库与认证 HTTP 验证，会构建应用后测试实际编译产物；认证测试只清理自身随机前缀账号。不要对生产数据库执行开发测试。

## 分类接口

以下接口均需 Bearer 令牌。分类为全后台共享，任意已登录用户可以维护；当前不区分管理员角色、不实现分类层级。

| 方法与路径 | 用途 | 成功结果 |
| --- | --- | --- |
| POST /categories | 创建，body 为 `{ "name": "数码配件" }` | 201；分类资料 |
| GET /categories | 分页列表、名称搜索 | 200；分页结果 |
| GET /categories/{id} | 查看分类 | 200；分类资料及 productCount |
| PATCH /categories/{id} | 修改 name | 200；更新后的分类 |
| DELETE /categories/{id} | 删除未引用分类 | 204，无响应正文 |

名称先 trim，长度 1–120 字符，不允许空白或 null。PATCH 不接受空对象或额外字段。分类名称目前不限制唯一。不存在的分类返回 404；分类下有任何商品（含其他用户商品）时，数据库外键阻止删除并返回 409，需先调整关联商品。

## 商品接口

所有商品接口均需 Bearer 令牌。已登录用户可查看共享商品目录，但仅创建者能编辑和删除。创建者从令牌确定，客户端不能指定或修改 userId。

| 方法与路径 | 用途 | 成功结果 |
| --- | --- | --- |
| POST /products | 创建商品 | 201；商品详情 |
| GET /products | 名称、分类、价格、库存组合筛选与排序 | 200；分页结果 |
| GET /products/{id} | 查看商品详情 | 200；商品详情 |
| PATCH /products/{id} | 部分修改自己创建的商品 | 200；更新后的商品 |
| DELETE /products/{id} | 删除自己创建的商品 | 204，无响应正文 |

先创建分类，复制返回的 UUID，再提交商品：

```json
{
  "name": "USB-C 充电器",
  "description": "65W 多口充电器",
  "price": "129.90",
  "stock": 20,
  "categoryId": "替换为实际分类 UUID"
}
```

商品名 trim 后长度 1–200；描述可选，最长 10000 字符，默认空字符串。price 必须是非负十进制字符串，最多两位小数，最大 `9999999999.99`，不接受 JSON 数字、科学计数法、NaN、无穷值或前后空白。返回金额固定两位小数，避免前端使用浮点计算。stock 为 JSON 整数，范围 0–2147483647，创建时默认 0。

PATCH 只能提交 name、description、coverImage、price、stock、categoryId 中的一个或多个字段；不提交的字段保持原值，null、空对象及额外字段返回 400。分类必须存在；引用不存在的分类返回 400。商品不存在返回 404；非创建者编辑或删除返回 403。UUID 格式错误返回 400。

详情及列表项含 category（id/name）、user（id/username），不包含创建者邮箱、密码或密码哈希。

## 分页与搜索

分类列表维持原约定：`page` 默认 1、范围 1–1000000；`pageSize` 默认 20、范围 1–100；`search` trim 后 1–100 字符、不区分大小写；返回 `{ items, total, page, pageSize, totalPages }`，按 createdAt、id 降序排序。

商品列表 `GET /api/products` 的所有筛选可组合，均为可选：

| 参数 | 类型与规则 | 示例/默认值 |
| --- | --- | --- |
| page | 整数，1–1000000 | 默认 1 |
| pageSize | 整数，1–100 | 默认 **10**；前端显式传递 |
| name | trim 后 1–200 字符，名称模糊匹配，大小写不敏感 | `充电器` |
| search | **deprecated**，旧名称查询，trim 后 1–100 字符；同传时 name 优先 | `充电器` |
| categoryId | 分类 UUID；扁平结构，仅当前分类 | 实际 UUID |
| minPrice | 非负金额字符串，最多 10 位整数、2 位小数；价格 **>=** 此值 | `10.00` |
| maxPrice | 格式同 minPrice，价格 **<=** 此值；同传时必须 >= minPrice | `100.00` |
| stockStatus | `zero`：stock **= 0**；`low`：stock **> 0 且 < LOW_STOCK_THRESHOLD**；`normal`：stock **>= LOW_STOCK_THRESHOLD** | 全局阈值默认 6 |
| sortBy | 白名单 `price / stock / createdAt / updatedAt` | 默认 createdAt |
| sortOrder | `asc / desc`，id 的方向跟随主字段 | 默认 desc |

价格为非空字段，无空价格分支；区间为闭区间，可单独传上下限。不增加 status 字段或状态筛选。金额比较使用数据库 Decimal。未知字段、非法枚举、重复参数数组、格式错误、颠倒价格区间和超限分页返回 400。

示例：`/api/products?page=1&pageSize=10&name=充电器&minPrice=10&maxPrice=100&stockStatus=low&sortBy=price&sortOrder=asc`。

返回 `{ list, items, total, page, pageSize, totalPages, lowStockThreshold }`。`list` 为新客户端使用的列表；`items`（deprecated）与 list 完全相同，`totalPages`（deprecated）保留旧客户端兼容；`lowStockThreshold` 供列表库存标签与服务端阈值保持一致。分类响应不变。

主排序字段后追加同方向 id，保证相同价格、库存、时间下分页稳定。排序字段均为 NOT NULL，因此不会出现空值，满足 NULLS LAST；Prisma 对非空列不接受显式 nulls 选项，今后若允许空值必须同步补上 `nulls: 'last'`。排序仅使用显式 Prisma 字段映射，不拼接 SQL。列表与计数仍在同一 RepeatableRead 快照中读取。未匹配时 list/items 为空且 total/totalPages 为 0；页码超出结果时列表为空但保留真实 total。

前端在商品列表提供筛选与排序控件，URL query 是条件来源，刷新及浏览器前进/后退可恢复；请求防抖 300ms，筛选或排序变化回到第 1 页。非法价格在输入框旁提示并暂停请求。加载、空结果和可重试网络错误有独立反馈。

## 本阶段验证

商品/分类新增 59 项 HTTP 测试，覆盖 CRUD、鉴权、归属、分页、过滤、金额精度及边界、非法输入、引用删除和 Swagger。连同原有测试，共 79 项 HTTP 测试、两组数据库回归通过。测试会自动清理自身随机生成的记录，不清空业务库。
