# 商品上下架实施计划

> 使用 subagent-driven-development 分工实现，TDD 验证后由主代理集成、审查和部署。用户已选择并授权实现前述最小功能。

## 规格与接口

- Product.status 使用 PostgreSQL/Prisma ProductStatus 枚举 PUBLISHED/OFFLINE；已有和新建商品默认 PUBLISHED，保持旧流程兼容。不引入草稿、审核、批量操作或新权限点。
- PATCH /api/products/:id/status，严格 DTO `{status: 'PUBLISHED' | 'OFFLINE'}`，JWT + product:update + 对应 OWN/ALL 范围，越权/不存在统一404，成功200返回 ProductResponseDto。
- 商品创建/普通编辑 DTO 不接受 status，专门状态接口负责切换；切换幂等，不变更库存、stockVersion、订单快照或库存流水。
- 商品列表 GET /api/products 支持可选 status，列表和 total 共享 where。后台仍能查看下架商品，前端状态筛选同步 URL 并重置页码。
- 新订单只能使用 PUBLISHED 商品；在已有商品行锁取得后读取状态并拒绝下架商品409，整单失败不扣库存、不留订单及流水。上下架取得相同行锁，串行化与下单的竞争。
- 相同幂等键已成功订单在下架后重试仍返回原结果；既有订单确认/发货/完成/取消不因下架改变。
- 前端列表/详情显示状态标签及有权限的上架/下架操作，确认、loading、成功/失败反馈。录单商品选择请求显式 status=PUBLISHED；后端继续兜底。
- 同步桥复制 status；两库分别执行增量迁移，主库单写策略不变。升级前备份、停写、排空队列，先升级结构再重建桥及应用。

## 任务和文件

- [x] 后端 TDD：新增 backend/test/product-status.e2e-spec.ts，先对旧 dist 运行观测404/缺少status失败，再实现 products Controller/DTO/Service、product-list-query、orders Service。覆盖本人/他人/ALL/无权限、非法DTO与字段、同值、筛选分页、库存不变、订单拒绝/幂等/历史状态及锁竞争、Swagger。
- [x] 数据与同步：schema 增加枚举/字段/索引；隔离开发和影子 schema 执行 validate、migrate dev --create-only，审查 SQL。bridge.ts 增加列；集成测试验证存量默认、空库、两库复制上下架及库存不变；更新 verify-orders.ts。
- [x] 前端 TDD：Product 类型、query和api方法；列表状态筛选/列/操作，详情状态/操作，OrderCreateModal 已上架筛选。Playwright mock 对旧版本先失败，覆盖URL、权限、反馈、录单过滤。
- [x] 审查：检查权限不是角色名判断；订单和状态切换共享锁；状态切换不触发库存流水；普通编辑不覆盖并发状态；禁止新增订单绕过。
- [x] build、lint、format:check、完整隔离 test:orders、双库集成、线上只读验收；更新 README、API、数据库、架构、部署文档及本记录。
- [x] 备份两库、迁移并核对已有行与新列默认、重建 Docker并校验健康；Conventional Commit，推送 GitHub main。

## 决策记录

Ruling: 复用 product:update 而非新增 product:publish 权限 — 用户要求最小功能且已有可配置 OWN/ALL — 以后需要职责分离时可新增权限。
Ruling: 已有及新建默认已上架 — 保持现有录单和商品创建兼容 — 首版不引入草稿。
Ruling: 按用户本次授权继续实现及增量部署，SQL在生成后由代理审查 — 本次仅新增结构，不重置或删除业务数据；沿用双库备份与一致性验证。

## 验证与交付（2026-11-12）

- 后端专项先在旧 dist 观测 8 条失败（缺少状态/接口），实现后 8 条通过，包含真实锁排队的两种竞争顺序。前端旧 Docker 缺少状态筛选时红测；同步旧桥保持 PUBLISHED 而非复制 OFFLINE 时红测，增加复制列后转绿。
- 最终 build、lint、format:check 通过；完整隔离 test:orders 后端 285 条、浏览器 43 条通过，数据库迁移无漂移及 9 条隔离集成检查通过。新增页面测试覆盖筛选 URL、OWN/ALL、权限点、确认、失败重试、加载与重复提交、录单过滤。
- 调整测试以容忍 Ant Design 双字按钮空格、loading 图标可访问名称及弹窗关闭动画；构建并发时曾出现环境 hook 超时，最终串行完整回归通过。产品逻辑未为测试定位问题做额外变更。
- 独立只读审查未发现阻断问题。状态写不动库存版本/流水，普通编辑显式字段不覆盖状态；迁移 SQL 为 create-only 后审查并补事务边界。
- 已暂停写入、排空队列、完整备份两库并验证归档；迁移后核对 4 个商品默认 PUBLISHED，原有 6 个订单及其明细/日志、6 条库存流水、账号、角色及授权逐字段保留，各库审计分别保留。
- 两库状态与业务数据一致，队列为零。Docker backend/frontend/db-sync/db 全部健康；8088 只读验收通过 Swagger 状态接口、状态标签/筛选/按钮和录单 PUBLISHED 查询，未插入验收业务数据。
