# Socket.IO 实时通知规格

## 1. 功能与范围

本系统是 NestJS + Prisma/PostgreSQL、React + Ant Design 的后台管理系统。首版采用单实例 Socket.IO，不引入 Redis，不新增数据库表。

| 场景 | 接收方 | 行为 |
| --- | --- | --- |
| 商品新增、修改、删除 | 全部登录用户 | 合并刷新商品列表和相关详情 |
| 分类新增、修改、删除 | 全部登录用户 | 刷新分类列表、商品分类选项及相关商品展示 |
| 密码或角色修改成功 | 被修改用户的所有在线会话 | 通知重新登录并断开旧连接 |
| 连接生命周期 | 当前客户端 | 展示连接中、已连接、中断 |

例如 py666 修改库存，py667 无需手动刷新即可看到新值。读取全部商品、运营人员只修改自己的商品、管理员管理全部商品、分类仅管理员维护等现有权限保持不变。

## 2. 数据流与事件契约

商品及分类的 CRUD 继续使用 REST：HTTP 请求 → 数据库操作成功/事务提交 → 通知 → 前端重新请求 REST 获取权威数据。Socket 不提供写接口，也不接受客户端指定身份、任意房间或广播请求。

连接路径 `/socket.io/`，默认 namespace。客户端仅通过 `auth.token` 传递 JWT，禁止放入 URL query。服务端事件：

- `product:changed`、`category:changed`：`{ eventId, id, operation }`，operation 为 `created | updated | deleted`，eventId 为 UUID。只发送资源标识与操作，不携带完整商品、密码、JWT 或 tokenVersion。
- `session:invalidated`：`{ reason }`，reason 为 `passwordChanged | securityChanged | expired`。只发给目标用户，随后断开连接。
- 前端内部 `realtime:connected`：每次连接成功触发，用于首次连接与重连补拉；不是服务端业务事件。

商品列表原分页、排序、筛选及统计契约不变，刷新仍由原接口一次获取列表和总数。失败的数据库操作不广播；推送异常不得改变已成功提交的 HTTP 操作结果。首版通知尽力发送，不持久化、不保证重放/恰好一次，事件 ID 用于追踪，最终一致性靠重连补拉和手动刷新。

## 3. 认证与连接安全

HTTP 与 Socket 共享 JWT 验证服务：校验 HS256 签名、issuer、audience、过期时间、sub 和 tokenVersion，再查询用户并比对数据库 tokenVersion。HTTP Guard 保留原认证行为，不把 HTTP Guard 直接套在 Socket 上。

连接成功前完成验证，由服务端决定身份和接收范围；未完成认证的连接不可收到广播。无效、过期、撤销或缺失 JWT 通过 connect_error 拒绝，错误不包含凭据。设置明确的认证错误 code，网络错误不错误清除正常登录态。

登录后建立连接，退出后断开；服务器在 JWT 到期时断开，并定期（30 秒）重新校验数据库凭证版本，覆盖跨库同步/外部角色密码修改。应用内改密/改角色必须在事务提交后立即通知目标用户并断开旧连接，不影响其他用户。不缓存 tokenVersion。周期校验避免重叠，断连/应用销毁清理定时器。限制握手认证等待，连接异常不影响 REST 使用。

仅允许部署配置 FRONTEND_ORIGIN 的浏览器来源；支持代理下的同源连接及无 Origin 的服务端测试客户端。服务端控制心跳，客户端自动重连，不创建第二个连接或泄露监听器。

## 4. 前端行为

集中式 RealtimeProvider 管理每个登录会话唯一连接，useRealtimeEvent 订阅事件，组件卸载时注销。兼容 React StrictMode 的 effect 重建，退出/过期立刻关闭连接。顶部显示连接状态，中断时仍可正常使用 REST 和手动刷新。

商品列表收到连续商品或分类事件后必须使用 **300ms 防抖合并刷新**；刷新与重连补拉复用同一队列，保留当前 URL 分页、pageSize、名称、分类、价格、库存和排序，不重置为第一页。每次连接成功补拉最新数据，覆盖断线期间丢失的事件。请求取消、失败和重试沿用现有页面机制。

编辑中的表单不得被远程数据覆盖，显示数据可能已变化提示；关闭/保存表单后再读取最新值。分类变更更新表单选项且保留已输入字段。详情被删除后提示并返回列表，重连发现 404 同样处理。安全事件复用当前会话失效逻辑和登录页提示。

## 5. 模块与部署

后端 `backend/src/realtime/` 包含 realtime.module.ts、realtime.gateway.ts、realtime.service.ts、realtime.events.ts。共享验证服务位于 auth 模块。商品服务在增删改成功后调用通知；分类及安全相关服务只增加提交后通知，不改变业务规则。

前端 `frontend/src/realtime/` 包含 RealtimeProvider、useRealtimeEvent 及必要的上下文/刷新 hook。依赖 NestJS websockets/platform-socket.io、socket.io 和 socket.io-client，版本需与 NestJS 12、Node.js 26 兼容。

Socket 与 HTTP 共用后端端口 3000，不额外暴露端口。Nginx `/socket.io/` 代理保留路径，设置 HTTP/1.1、Upgrade、Connection 和超时，兼容 polling 和 WebSocket；Vite 开发代理启用 ws。Docker 管理后台仍从 8088 访问。HTTP Swagger 不描述 Socket 事件，本文件为 Socket 契约，其他 HTTP 契约不变。

## 6. 双数据库边界及后续优化

首版只对经 NestJS REST 成功提交的写操作即时通知。直接在 PostgreSQL、Prisma Studio 或同步桥修改数据绕过应用，不会生成商品/分类广播；安全凭证变更由 30 秒周期校验兜底。

后续若需要数据库直改实时刷新，应在同步提交后通过同步日志/数据库监听产生事件，标记来源与事件 ID，防止双库循环和重复广播。多实例部署再引入 Socket.IO Redis adapter；需要可靠通知再考虑事务 outbox、重放/补偿。当前不增加 Redis、通知历史或新的迁移。

## 7. 验收与测试

1. 两个不同登录账号打开商品列表，一端增删改成功，另一端 300ms 合并刷新；保留分页、排序、筛选，列表和总数来自相同 REST 条件。
2. 所有人可收到共享商品通知，但运营人员仍不能修改他人商品；不得通过 Socket 伪造房间、身份或写请求绕过权限。
3. 缺失、无效、过期、错误 issuer/audience、已撤销 JWT 拒绝连接；合法 JWT 成功连接且能收到模拟商品更新。先运行这些后端测试确认红灯，再实现并转绿。
4. 密码/角色事务提交后，目标旧连接立即断开、旧 HTTP JWT 仍为 401；其他账号不受影响；过期连接断开，外部版本变化周期校验生效。
5. 断网显示中断，自动重连后补拉最新商品；连续事件 300ms 合并且监听器不累积；编辑内容不被覆盖、被删详情可回列表。
6. 数据库失败不通知；推送失败不使已提交商品 CRUD 返回失败；Socket 网络异常时 REST/手动刷新可用。
7. Vite 开发代理及 Docker/Nginx 8088 入口可建立 WebSocket，具备 Upgrade/Connection 配置。集成测试使用隔离应用/数据库，不自动重启当前业务服务器。

交付顺序：规格独立提交 → 测试先红 → 后端实现转绿 → 前端与代理 → 相关回归/文档 → 代码提交。验证结果与启动、双窗口操作方法在交付时提供；未执行的检查如实注明。