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

商品与分类 REST 接口将在下一阶段实现。
