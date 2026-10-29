# API 使用说明

基础地址：`http://localhost:3000/api`。
Swagger 页面：`http://localhost:3000/docs`；OpenAPI JSON：`http://localhost:3000/docs-json`。

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

JWT 使用 HS256，只接受匹配本系统 issuer/audience、包含有效用户 ID 和有效期且签名正确的令牌。每次鉴权都会确认用户仍存在。当前未实现刷新令牌和服务端登出撤销；客户端退出时删除令牌，已签发令牌在有效期内仍有效（删除用户或更换密钥会使其失效）。

## 启动配置

在 `backend/.env` 配置：

- `DATABASE_URL`：真实项目数据库连接。
- `JWT_SECRET`：自行生成至少 32 随机字节的密钥，建议保存为 64 位十六进制字符串。不设默认密钥，缺失或过短时启动失败。
- `JWT_EXPIRES_IN_SECONDS`：60–86400 的整数，默认 3600。
- `FRONTEND_ORIGIN`：允许跨域的前端来源，默认 `http://localhost:5173`。
- `PORT`：默认 3000。

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
| GET /products | 分页搜索、按分类筛选 | 200；分页结果 |
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

PATCH 只能提交 name、description、price、stock、categoryId 中的一个或多个字段；不提交的字段保持原值，null、空对象及额外字段返回 400。分类必须存在；引用不存在的分类返回 400。商品不存在返回 404；非创建者编辑或删除返回 403。UUID 格式错误返回 400。

详情及列表项含 category（id/name）、user（id/username），不包含创建者邮箱、密码或密码哈希。

## 分页与搜索

两种列表均支持 `page`（默认 1，范围 1–1000000）、`pageSize`（默认 20，范围 1–100）和可选 `search`（trim 后 1–100 字符，按名称搜索，不区分大小写）。商品列表额外支持 `categoryId`，可与搜索同时使用。不得传入未知查询参数；小数、负数、空字符串等非法页码返回 400。

例如 `/api/products?page=1&pageSize=20&search=充电器&categoryId=<实际UUID>`。列表响应统一为 `{ items, total, page, pageSize, totalPages }`，按 createdAt 降序、id 降序稳定排序，列表与计数在同一数据库快照中读取。未匹配时 items 为空、total/totalPages 为 0；超出最后一页时 items 为空但保留实际 total。

## 本阶段验证

商品/分类新增 59 项 HTTP 测试，覆盖 CRUD、鉴权、归属、分页、过滤、金额精度及边界、非法输入、引用删除和 Swagger。连同原有测试，共 79 项 HTTP 测试、两组数据库回归通过。测试会自动清理自身随机生成的记录，不清空业务库。
