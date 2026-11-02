# 商品图片上传

上传接口实际地址为 `POST /api/upload/image`（沿用全局 `/api` 前缀），使用 JWT 和 multipart 单文件字段 `file`，最多 5 MiB，允许 JPG/JPEG/PNG/WEBP。返回 `{ code: 0, message: 'ok', data: { url: '/uploads/UUID.png' } }`，静态图片路径不含 `/api`，可公开访问。

商品创建/更新可传 `coverImage`，允许合法 HTTP(S) URL 或上传返回的相对图片路径；不传则保留，传 `""` 清空，响应无封面时为 `null`。上传组件在创建和编辑表单中显示缩略图，支持预览和移除；移除仅清空字段，服务器文件保留。上传失败保留表单且可重试，上传中禁止提交商品。

前端 Upload 组件的完整源码见 [CoverImageUpload.tsx](../frontend/src/components/CoverImageUpload.tsx)，表单接入见 [ProductFormModal.tsx](../frontend/src/components/ProductFormModal.tsx)。接口/数据库/部署细节分别见 [API](api.md)、[数据库](database.md)、[部署](deployment.md)。

## 完整变更文件清单

| 类型 | 文件 | 作用 |
| --- | --- | --- |
| 新增 | `backend/src/upload/upload.module.ts` | 独立上传模块，导入现有认证模块 |
| 新增 | `backend/src/upload/upload.controller.ts` | JWT 上传接口、Multer 单文件限制及 Swagger |
| 新增 | `backend/src/upload/upload.service.ts` | 文件格式/签名检查、UUID 命名、本地写入 |
| 新增 | `backend/src/upload/upload.config.ts` | 上传路径、5 MiB 限制及扩展名白名单 |
| 新增 | `backend/src/upload/dto/upload-response.dto.ts` | 明确上传响应结构供 OpenAPI 使用 |
| 新增 | `backend/src/products/dto/cover-image.validator.ts` | 校验 HTTP(S)/相对图片 URL 和清空值 |
| 新增 | `backend/prisma/migrations/20261102063340_add_product_cover_image/migration.sql` | 仅新增可空封面列，保留既有数据 |
| 新增 | `backend/test/upload.e2e-spec.ts` | 上传鉴权/格式/大小、封面 CRUD 与 Swagger 回归 |
| 新增 | `frontend/src/components/CoverImageUpload.tsx` | 受控 AntD Upload：预览、移除、loading、错误反馈 |
| 修改 | `backend/src/app.module.ts` | 注册上传模块 |
| 修改 | `backend/src/configure-app.ts` | `/uploads` 静态访问及 nosniff 响应头 |
| 修改 | `backend/src/products/dto/product.dto.ts` | 请求/响应增加封面契约 |
| 修改 | `backend/src/products/products.service.ts` | 创建/更新持久化封面，空字符串转 null |
| 修改 | `backend/prisma/schema.prisma` | 增加 `Product.coverImage` |
| 修改 | `backend/prisma/migrations/migration_lock.toml` | Prisma 生成迁移时补充的锁文件注释 |
| 修改 | `backend/scripts/sync/bridge.ts` | 双向同步包含封面列 |
| 修改 | `backend/scripts/sync.integration.test.ts` | 覆盖新迁移与封面的双向传递、清空 |
| 修改 | `backend/package.json`、`backend/package-lock.json` | 增加 Multer 类型依赖及锁定版本 |
| 修改 | `backend/Dockerfile` | 创建可写上传目录 |
| 修改 | `backend/.dockerignore` | 排除上传文件及本机测试产物 |
| 修改 | `.gitignore` | 忽略实际上传文件 |
| 修改 | `docker-compose.yml` | 挂载共享且持久的上传目录 |
| 修改 | `frontend/src/api/client.ts` | 使用统一 Axios/JWT 上传 FormData |
| 修改 | `frontend/src/api/types.ts` | 商品封面和上传响应类型 |
| 修改 | `frontend/src/components/ProductFormModal.tsx` | 封面字段、回显、提交和上传期间禁用保存 |
| 修改 | `frontend/vite.config.ts` | 开发/预览代理 `/uploads` |
| 修改 | `frontend/nginx.conf` | 图片代理和 multipart 请求体上限 |
| 修改 | `frontend/e2e/workspace.spec.ts` | 上传失败重试、保存/预览/清空及独立栈清理 |
| 修改 | `README.md` | 增加功能文档入口 |
| 修改 | `docs/api.md` | 上传路径、响应、限制及封面清空约定 |
| 修改 | `docs/database.md` | ER 图、封面列及先审查后部署的迁移步骤 |
| 修改 | `docs/architecture.md` | 上传模块、静态资源与文件/数据库职责 |
| 修改 | `docs/deployment.md` | 持久化、写权限、代理、双库升级 |
| 新增 | `docs/product-images.md` | 本说明及完整变更清单 |

本功能不调整现有商品归属、分类引用、分页、价格或库存逻辑，也不提供服务器图片删除接口。

## 已执行验证（2026-11-02）

前后端构建、ESLint、格式检查及同步脚本类型检查通过。独立数据库完成 98 项 HTTP 测试（含新增 19 项上传/封面验证）、2 项数据库测试；浏览器原有 3 组流程及新增的上传失败重试、loading、保存、回显、预览、清空流程通过。专用双库同步测试 10 项通过（含父测试），覆盖封面 URL 传递和清空。新迁移经 `--create-only` 生成、SQL 审查及隔离验证后，已分别部署到本机和 Docker 项目库；两边 Prisma 结构与模型一致，补传完成后业务数据一致。随机测试记录和文件已清理，原有业务服务保持关闭。
