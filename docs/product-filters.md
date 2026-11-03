# 商品筛选与排序

本次范围仅为商品列表查询、列表页、相关配置、索引、测试及文档。认证、分类管理、商品创建/编辑/删除、图片上传和数据库同步逻辑不变。

## 已确认口径

- 不新增 status，不提供状态筛选；分类为扁平结构。
- LOW_STOCK_THRESHOLD 默认 6，可在进程环境配置；zero: stock = 0；low: 0 < stock < 阈值；normal: stock >= 阈值。配置必须是 1–2147483647 的整数。Docker Compose 将根目录配置传入后端。
- 价格非空；上下限为 Decimal 字符串、闭区间，允许单边区间。
- 新 name 优先于 deprecated search；返回 list，保留 deprecated items、totalPages。
- 商品默认每页 10，前端显式传 pageSize，分类默认 20 不变。
- 默认 createdAt desc，四个排序字段白名单；id 跟随主排序方向。现有排序列非空，天然满足 NULLS LAST。
- URL 保留条件；输入、筛选、排序请求防抖 300ms；筛选变化回到第 1 页。
- 中文等输入法组词时只更新输入框草稿，不更新 URL、不用未确认拼音搜索；选字完成后再进入 300ms 防抖。搜索按钮在组词期间不提交；候选词栏由系统输入法提供，属于正常界面。名称与已选分类等条件仍按 AND 组合。

详细参数、返回值和示例见 [API 文档](api.md#分页与搜索)。Swagger `/docs`，生成 JSON `/docs-json`。

## 文件清单

| 文件 | 作用 |
| --- | --- |
| backend/src/products/dto/product-query.dto.ts（新增） | 商品专用查询 DTO、枚举、价格区间校验及 Swagger 参数 |
| backend/src/products/product-list-query.ts（新增） | 组合条件、排序字段白名单映射、id 稳定排序 |
| backend/src/products/products.config.ts（新增） | 读取并验证全局低库存阈值 |
| backend/src/products/dto/product.dto.ts | 导出查询 DTO，增加 list、兼容字段弃用标记与阈值元数据 |
| backend/src/products/products.service.ts | 接入组合查询，返回新旧列表和阈值，保留快照分页 |
| backend/src/products/products.controller.ts | 更新列表 Swagger 说明 |
| backend/prisma/schema.prisma | 增加查询索引声明 |
| backend/prisma/migrations/20261103023330_product_list_filter_indexes/migration.sql（新增） | 三个非破坏性 CREATE INDEX |
| backend/.env.example、.env.example、docker-compose.yml | 阈值示例、比较符注释及容器配置 |
| frontend/src/components/ProductListFilters.tsx（新增） | 名称、分类、价格、库存、排序控件及字段错误 |
| frontend/src/pages/product-list-query.ts（新增） | URL 参数读取与前端金额校验 |
| frontend/src/pages/ProductsPage.tsx | URL 驱动列表、300ms 防抖、list 消费、库存标签阈值及反馈 |
| frontend/src/api/types.ts、frontend/src/api/client.ts | 商品查询和响应类型；分类客户端约定不变 |
| frontend/src/index.css | 仅针对商品筛选栏的响应式布局 |
| backend/test/product-query.spec.ts（新增） | 查询校验、组合条件、排序映射与配置单测 |
| backend/test/product-filters.e2e-spec.ts（新增） | 真实 PostgreSQL 的 HTTP 查询及 OpenAPI 验证 |
| backend/vitest.config.e2e.ts | 将新增单测纳入后端测试命令 |
| frontend/e2e/product-filters.spec.ts（新增） | 浏览器请求、URL、刷新、历史导航、错误和加载反馈 |
| docs/api.md、docs/database.md、docs/product-filters.md、README.md | 使用约定、索引与交付说明 |

## 部署

先备份数据，停止应用写入，再在后端目录使用 `npm.cmd run db:deploy` 部署已审查迁移，然后重新构建并启动服务。不得 reset。使用双库同步时，两边数据库必须分别部署迁移，DDL 不会通过同步传递。Docker 部署使用 Compose 的 migrate 服务；本次测试不启动实际业务容器或改动业务数据库。

验证使用独立 PostgreSQL 容器及独立影子库：先 `--create-only` 生成迁移并审查，再验证已有记录的全部字段保持不变、空库应用完整迁移，以及 schema diff 无漂移。真实业务库的索引部署留待启动部署时执行。

## 本次验证（2026-11-03）

- 前后端构建、lint、Prettier 检查通过。
- 后端 `npm.cmd test`：151 项单测/HTTP 测试、2 项数据库回归通过，包含生成的 OpenAPI 元数据检查。
- 前端 `npm.cmd run test:e2e`：7 条浏览器流程全部通过，包含原有 4 条回归及新增 3 条筛选流程。首次下拉测试误点 Ant Design 隐藏辅助选项，已修正为可见选项定位后全量通过。
- 空库部署全部 4 个迁移成功；已有数据测试库追加索引迁移成功，迁移前后商品全部字段一致；Prisma schema diff 无差异。
- 测试仅使用隔离数据库及临时测试服务；未部署到本机/Docker 业务库，未启动业务服务。测试结束后清理独立测试容器和临时凭据，保留原有数据及停服状态。

后续中文输入修复：新增浏览器回归在旧版本确认“未选字拼音触发请求”，修复后商品筛选 4 条浏览器测试通过（拦截 API，不操作业务数据），包含组词期间无请求/URL 变化、选字后搜索、焦点保留、分类条件保留及原有 URL 历史导航。前端构建、lint、格式检查通过；仅更新运行中的前端容器，后端和数据库未改动。本次未重跑后端及其他模块测试。
