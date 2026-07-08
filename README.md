# PTY MCP Terminal

一个基于 Node/TypeScript 的全栈真实 PTY 终端系统。后台管理多个 PTY session，Web 端用 xterm.js 实时查看/切换/操作终端，MCP 端给 AI agent 暴露创建、读取、写入、关闭 PTY 的工具。

后台（HTTP + WebSocket + MCP）、前端（Vite + xterm.js）、共享类型三层 monorepo。

---

## 快速启动

```bash
# 安装依赖
pnpm install

# 构建并一键启动（推荐）
pnpm serve

# 或者开发模式（热重载）
pnpm dev
```

- **Web**: http://localhost:5173
- **HTTP/WebSocket**: http://localhost:8787
- **MCP stdio**: 通过 `run-mcp.sh` 暴露（见下方 MCP 配置）

> 如果 8787 端口已有进程，`pnpm start` / `pnpm serve` 会复用现有进程，不会重启。
> 构建后如需重启后台，先 `kill $(lsof -ti:8787)` 再 `pnpm start`。

### 验证

```bash
pnpm typecheck
pnpm build
pnpm test
```

---

## Web 界面用法

### 左侧侧边栏

- **会话列表**：每个 session 显示别名（如有）或原始命令、运行状态、短 ID
- **双击标题**：inline 编辑别名（Enter 保存，Escape 取消）
- **单击选中**：切换当前显示的终端
- **右键菜单**：复制 Session ID / 复制 Command
- **短 ID 点击**：复制完整 session id 到剪切板
- **新建按钮**：创建默认 shell PTY
- **设置按钮**：左下角，配置字体、字号、主题（持久化到 localStorage）

### 主区域

- **顶部栏**：当前 session 的别名/命令/工作目录，右侧红色停止按钮
- **终端区**：xterm.js 渲染，支持 ANSI 颜色、控制字符、Nerd 字体图标
- **终端选中文字**：鼠标松开自动复制到系统剪切板
- **输入提示**：底部提示敏感输入（密码等）应在网页终端直接键入，不经过 agent

### 设置

- 字体：可自定义 font-family，默认 Maple Mono Nerd 字体栈
- 字号：9-28
- 主题：Default Dark / Dracula / One Dark / Solarized Dark / Gruvbox Dark / Nord

---

## MCP 配置

MCP 通过 stdio 方式暴露，agent 可以通过以下工具操作 PTY：

| 工具 | 说明 |
|------|------|
| `pty_create` | 创建真实 PTY，等待 3 秒返回初始输出 + sessionId + cursorId |
| `pty_list` | 列出所有 session 摘要 |
| `pty_read` | 按 sessionId + cursorId 读增量输出，推进 cursor |
| `pty_write` | 向 PTY 写入 stdin |
| `pty_close` | 关闭并清理 session |

### Hebbian / Claude Desktop 配置

编辑 `/Users/ricardo/.hebbian/mcp.json`（或相应配置文件），添加：

```json
{
  "pty-terminal": {
    "command": "/Users/ricardo/code/courtify/zhongxin/pty-mcp-terminal/run-mcp.sh",
    "args": [],
    "disabled": false
  }
}
```

`run-mcp.sh` 会自动构建并执行 `dist/mcp.js`，确保 stdout 只有 JSON 消息（无脚本横幅等污染）。

### MCP 注意事项

- **Agent 创建的 session 前端可见**：MCP 和 Web 共享同一个后台 PtyManager，agent 新建的 session 会通过 WebSocket 推送到前端。
- **敏感输入走网页**：密码、token 等敏感内容应让用户在网页终端直接键入，不经过 agent 的 stdin 写入。
- **SSH session 自动保活**：命令为 `ssh` 时自动注入 `ServerAliveInterval=60` 和 `ServerAliveCountMax=10080`，7 天不断连。

### Agent 使用示例

```
// 创建一个 PTY
result = await pty_create({ command: "/bin/bash" })
sessionId = result.session.id
cursorId = result.cursorId

// 等待后读输出
output = await pty_read({ sessionId, cursorId })

// 执行命令
await pty_write({ sessionId, input: "ls -la\n" })
await sleep(1000)
output = await pty_read({ sessionId, cursorId })
```

---

## API 参考

### HTTP

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/sessions` | 列出所有 session |
| `POST` | `/api/sessions` | 创建 session |
| `GET` | `/api/sessions/:id/snapshot` | 获取完整快照（rawOutput） |
| `GET` | `/api/sessions/:id/read?cursorId=` | 增量读取 |
| `POST` | `/api/sessions/:id/write` | 写 stdin |
| `POST` | `/api/sessions/:id/resize` | 调整终端尺寸 |
| `PATCH` | `/api/sessions/:id` | 更新 session（支持 `alias`） |
| `DELETE` | `/api/sessions/:id` | 关闭 session |

### WebSocket

路径 `/ws`，事件：

- `session_created` — 新 session 创建
- `session_updated` — session 信息更新（如别名）
- `session_output` — 实时输出 chunk
- `session_exit` — 进程退出
- `session_closed` — session 被关闭

Web 前端使用 WebSocket 接收实时输出；断开时自动指数退避重连（1s → 30s 上限）。

---

## 架构

```
pty-mcp-terminal/
├── apps/
│   ├── server/           # Node/TS 后台
│   │   ├── src/
│   │   │   ├── index.ts       # 入口：HTTP + MCP
│   │   │   ├── http.ts        # Express HTTP API
│   │   │   ├── ws.ts          # WebSocket 广播
│   │   │   ├── mcp.ts         # MCP stdio server
│   │   │   └── pty/
│   │   │       ├── PtyManager.ts   # 核心：session 管理
│   │   │       ├── OutputBuffer.ts # 环形缓冲区 + cursor
│   │   │       └── output.ts       # ANSI 清理（MCP 输出）
│   │   └── dist/
│   └── web/              # React/Vite/xterm.js 前端
│       └── src/
│           ├── App.tsx          # 主组件
│           ├── api.ts           # HTTP + WS 客户端
│           ├── settings.ts      # 设置持久化
│           ├── terminalThemes.ts # xterm 主题
│           └── style.css
├── packages/
│   └── shared/           # 共享 TypeScript 类型
├── scripts/
│   └── start-all.mjs     # 一键启动脚本
├── run-mcp.sh            # MCP stdio 包装器
└── package.json
```

### 关键技术点

- **PtyManager**：全局单例，持有所有 session。MCP 与 WebSocket 共享此实例，agent 创建的 session 前端实时可见。
- **OutputBuffer**：环形内存缓冲区，每个 reader 有独立 cursor，支持增量读取。
- **MCP 输出净化**：agent 读取的文本会清理 ANSI 控制字符并折叠 `\r`；Web 端保留 raw output 给 xterm.js。
- **WebSocket 重连**：前端断线后指数退避自动重连，不弹错误提示。
- **SSH 保活**：SSH session 自动注入 OSI layer 5 keepalive，7 天不断连。

---

## 环境要求

- Node.js **LTS（20/22）** 推荐，非 LTS 可能 `node-pty` 原生模块不兼容
- `node-pty` 依赖系统编译工具链（Xcode Command Line Tools / build-essential）

首次运行报 `posix_spawnp failed` 时，检查 spawn-helper 权限：

```bash
chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
```

