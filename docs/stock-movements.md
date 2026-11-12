# 库存流水规格

## 范围与入口

保留现有创建订单扣库存、取消未发货订单回补、库存版本、商品删除及主副本规则。不引入 SKU、仓库、采购、预占、退货或独立菜单。商品详情新增库存流水标签，订单详情新增关联库存变动区。

## 记录契约

StockMovement 映射 stock_movements。字段：id(UUID)、productId(UUID，无外键，商品删除后保留)、productName(200)、ownerId(UUID，商品创建者快照，无外键)、type(BASELINE/INITIAL/ADJUSTMENT/ORDER_DEDUCT/ORDER_CANCEL)、beforeStock、quantityChange、afterStock、stockVersion、actorId(UUID 可空，无外键)、actorName(64，可空)、orderId(UUID 可空，无外键)、orderNo(40，可空)、reason(500)、operationKey(200 唯一)、createdAt(timestamptz)。不公开 operationKey/ownerId 内部字段。

变化前 + 变化量 = 变化后，库存与版本非负。BASELINE/INITIAL 可为零；其他记录变化量必须非零。商品版本、业务操作键防重复。所有库存更新和流水在同一事务，事务后再通知刷新。复用 stock_version_guard，不重复递增版本。流水追加写，不提供修改/删除接口，数据库拒绝修改/删除/截断。

## 写入规则

- 创建商品同事务写 INITIAL，包括初始零库存。
- 商品更新在事务锁内复核归属及 stockVersion。真实库存变化必须提供 stockReason（1–500，trim 后非空）；同值和仅编辑资料不写流水。stockReason 不能当商品字段存储。
- 创建订单在现有商品锁和订单事务内逐商品写 ORDER_DEDUCT；同幂等键重试不重复记录。
- 取消订单在现有状态锁和事务内写 ORDER_CANCEL，流水原因固定为“取消订单回补库存”；原始取消原因只保留在受订单权限保护的日志，防止商品所有者读取他人订单自由文本。确认、发货、完成不写流水。拒绝操作与事务失败不留流水。
- 已有商品在迁移写 BASELINE：0 → 当前库存，使用当前版本，说明为启用基线，不伪造历史采购/调整。不修改库存或其版本。只 PRIMARY/STANDALONE 回填；REPLICA 从主库复制，避免生成不同基线 UUID。
- 商品/账号物理删除不级联流水，名称、操作人和归属快照保留。订单原有禁止删除规则不变。

## 权限与查询

新增 stock:read 固定权限，支持 OWN/ALL。系统 OPERATOR 默认 OWN，ADMIN ALL，自定义角色不自动授予；为被新增授权的账号递增 tokenVersion，升级需重新登录。

OWN 按 ownerId（商品创建者快照）过滤，不按操作人过滤。列表和总数使用相同 where 及一致快照。无权限403；商品/订单越权与不存在统一404。可见流水不代表可见关联订单，不包含客户资料；响应 canViewOrder 由服务端根据订单权限和归属计算，前端同时检查 order:read 后才展示订单链接。

GET /api/stock-movements、GET /api/products/:id/stock-movements：page=1、pageSize=10(最大100)、type、createdFrom/createdTo、orderNo；全局接口另支持 productId/name。GET /api/orders/:id/stock-movements 另要求 order:read 和订单范围，并与 stock:read 范围取交集。按 createdAt desc/id desc 稳定排序。返回 {list,total,page,pageSize}，记录字段对应上述契约但排除 operationKey/ownerId。

## 双库与部署

stock_movements 为主库单写、追加表；同步桥只复制结果，不执行库存业务。扩充同步白名单和表列定义，按源事务复制库存/订单/流水。重复重放不新增、不得更新既有流水；冲突报错且整事务回滚。副本拒绝本地写入和逆向覆盖。

部署前备份两库，暂停所有商品/订单写入，停止旧同步程序前排空队列并核对库存。先升级两库结构，PRIMARY 生成基线、REPLICA 不生成，更新桥并复制基线，核对库存/流水及队列，再启动新版服务。SQL 必须先审阅，不 reset，不删除业务数据。

## 验收

覆盖初始化零库存、真实调整原因/同值/旧版本、库存版本衔接、商品改名/删除和账号删除快照；并发最后库存、缺货整单回滚、重复下单/取消、取消发货竞争、流水写入失败回滚；OWN/ALL、无权限、恶意字段、列表与总数一致、订单客户资料不泄漏；空库及存量迁移、期初唯一；双库同事务复制、重复重放、失败整组回滚及恢复、REPLICA 禁写。前端验证标签加载、分页、空态、错误重试、条件保留、调整原因和订单链接权限。
