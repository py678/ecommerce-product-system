---
name: swagger-sync
description: 修改 NestJS Controller、DTO、认证要求或响应契约后，核对生成的 Swagger/OpenAPI 与实际接口，并同步 API 使用文档。
---

触发条件：Controller/DTO 字段、路由、参数、认证、状态码或响应结构发生变化。

1. 对照实现列出变更的路由、请求 DTO、响应 DTO 和 Guard；保持 Swagger 文档生成配置正常启用。
2. 同步参数位置、必填/可选、类型、枚举、长度/范围、格式和示例；校验装饰器与 Swagger 元数据一致。金额沿用字符串契约，密码仅出现在必要的请求字段中，响应不得出现密码或哈希。
3. 核对成功状态码、分页结构、错误响应、Bearer 认证及归属拒绝策略；示例只使用虚构数据，不写真实凭据。
4. 在隔离测试应用中生成 OpenAPI，检查变更的 path、schema、required、security 和 responses，并以相关接口测试核对真实行为；不要仅以 Swagger 页面能打开判断同步完成。
5. 更新 `docs/api.md` 中受影响的用法；运行相关构建/测试，报告具体检查结果及未验证项。
