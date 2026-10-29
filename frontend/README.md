# 管理后台前端

React + Vite + TypeScript + Ant Design 管理后台，使用 React Router 和 Axios 对接 NestJS API。

在本目录执行 `npm.cmd ci`，然后 `npm.cmd run dev`，访问 http://localhost:5173。后端应运行于 3000 端口；Vite 将 `/api` 代理到后端，无须在页面配置密钥。

支持注册、登录、商品列表/详情/创建/编辑/删除、分类管理、分页搜索及分类筛选。受保护页面校验登录，401 清理会话并返回登录页。金额使用字符串传输，编辑和删除权限以服务端校验为准。

路由：`/register`、`/login`、`/products`、`/products/:id`、`/categories`。令牌保存在 sessionStorage，刷新后通过 `/auth/me` 恢复用户；退出清除本地令牌，不撤销服务器已签发令牌。

检查命令：`npm.cmd run lint`、`npm.cmd run format:check`、`npm.cmd run build`。

`npm.cmd run test:e2e` 使用已安装的 Edge 测试生产构建，会自动启动独立后端 3002 和前端预览 5174。需先配置 `../backend/.env`、安装后端依赖并完成迁移；两个测试端口应空闲。测试向配置的开发数据库写入随机前缀数据，只清理自身数据，勿连接生产库。其他浏览器可用 `E2E_BROWSER_CHANNEL` 指定已安装的 Playwright channel。

完整启动和部署说明见 [本地启动指南](../docs/local-start.md)。
