# eladrave 合并说明

## 合并范围

- 目标分支：`dev`，基于 `0xcaff/codex-web` 的 `2424e85`。
- 来源：`eladrave/codex-web` 的 `abdd22f`。
- 当前阶段只整合 eladrave；`codex-web-previous` 中此后的个人提交另行合并。
- 本地 Node.js 使用是验收目标。Docker、Cloud Run 及其版本固定值按历史保留，不声明可构建或可部署。

## 冲突处理原则

- Desktop 使用 0xcaff 的 `26.1007.30912` 及配套补丁，普通安装不读取旧 Dockerfile 的版本。
- 保留 0xcaff 的独立标签页窗口、JSON RPC 适配、断线重连和 bootstrap 重试修复。
- 保留 eladrave 的 Electron 数据路径、外部链接、OAuth 回调桥、Linux 终端原生模块及桌面服务兼容接口。
- eladrave 的单活标签页接管机制由 0xcaff 的多标签页模型替代。外部链接按发起请求的窗口定向发送；异步 IPC 和 MessagePort 回调均保持窗口上下文。
- 同一 OAuth 回调可能被多个标签页收到，服务端复用同一转发结果，避免重复消费授权回调。
- 保留 0xcaff 的 prompt 参数补丁，其已直接覆盖当前 composer；不再使用 eladrave 针对旧 bundle 的额外 default-text 补丁。
- 保留 0xcaff 对未知系统空闲状态的 `unknown` 返回值；保留 eladrave 的窗口加载事件及可见性处理。
- 按用户决定，保留软件设备密钥实现及 Docker 默认启用方式。该实现将 PEM 私钥保存为权限 `0600` 的文件，实际仍可导出，与其协议字段 `os_protected_nonextractable` 的名称不一致。

## 本地验证方式

使用依赖声明支持的 Node.js 版本。合并时使用本机 Node.js 25；默认 Node.js 26 超出 `better-sqlite3@12.9.0` 声明的支持范围。

```bash
npm ci --ignore-scripts
npm rebuild better-sqlite3 node-pty
npm test
# 首次准备 Desktop bundle：
npm run prepare
# 已有下载文件时：
HOSTED_CODEX_APP_ZIP=/path/to/ChatGPT-darwin-arm64-26.1007.30912.zip npm run build
node scripts/smoke_test_terminal_pty.mjs
```

自动化测试覆盖 Electron 生命周期、跨标签页链接定向、OAuth 校验与回调去重、MessagePort 缓冲及继承的状态恢复等行为。真实账户登录、远端 SSH 会话及 Docker 部署需要各自环境下的验收。

## 本次验证结果（2026-10-29）

- Node.js `25.0.0` 下的 `npm ci --ignore-scripts` 和两个原生模块重建通过；锁文件中缺失的可选依赖记录已修复。
- `npm test`：41 项测试通过，入口脚本测试通过。
- 服务端编译和浏览器 shim 单独的 TypeScript 类型检查通过。
- 使用真实 Desktop `26.1007.30912` ZIP 完成 `npm run build`，补丁、浏览器构建及服务端编译通过。
- 从 Desktop bundle 的模块解析路径运行终端 PTY smoke test，通过。
- 使用独立的临时 Codex 数据目录和 Chrome profile，两个标签页均显示登录页；关闭一个标签页后，另一个重载仍能恢复。未出现未捕获的 JavaScript 异常，服务端持续运行。
- 测试环境中的外部 Statsig 请求失败会产生启动等待，应用随后进入 fallback 并显示登录页。这不属于已验证的联网成功。
- 未执行真实账户授权、已登录对话、远端 SSH 主机连接或 Docker 部署验收。
