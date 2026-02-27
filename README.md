# 井字棋 · 最佳策略探索器

> Tic-Tac-Toe Optimal Play Explorer — 部署在 Cloudflare Worker 上的交互式井字棋最优策略可视化应用。

**🌐 在线体验：[https://tic-tac-toe.leidun.pp.ua](https://tic-tac-toe.leidun.pp.ua)**

## 概述

本项目通过 **Minimax 算法**穷举井字棋所有合法局面（5,478 种），计算每个状态的最优评估值，并以动画形式展示双方按最佳策略对弈的完整路径。

### 核心特性

- **服务端预计算** — Worker 首次被请求时运行 Minimax 穷举，生成完整查找表
- **KV 持久缓存** — 计算结果存入 Cloudflare KV，后续请求直接读取，零重复计算
- **客户端零计算** — 预计算表注入 HTML，浏览器端仅做查表 + 随机选择 + 动画渲染
- **两种游戏模式** — 体验不同视角下的最优博弈

## 游戏模式

### 模式一：你选第一步

用户点击棋盘任意一格作为 X 的开局，程序随机展示一条双方均走最优策略的路径。
结果永远是 **平局** — 因为井字棋在双方最优下无法制胜。

### 模式二：电脑先手（挑战模式）

电脑（X）在中心或四角随机落子，用户选择 O 的第二手位置：
- 若选择不当 → X 获胜，并提示哪些位置才能保平
- 若选择正确 → 平局，夸赞你的眼力

## 技术架构

```
请求 → Cloudflare Worker
          ├─ 查 KV 缓存 → 命中 → 注入数据到 HTML → 返回
          └─ 缓存未命中 → 服务端 Minimax 穷举
                           ├─ 生成完整查找表 (10,956 条目)
                           ├─ 裁剪至最优路径子集 (3,315 条目，-70%)
                           ├─ 统计合法局面 (5,478 种)
                           ├─ 异步写入 KV
                           └─ 注入数据到 HTML → 返回

浏览器端
  ├─ 读取 window.__DATA__ (裁剪后的查找表)
  ├─ minimax() = 纯查表 O(1)
  ├─ 随机选择最优着法生成路径
  └─ SVG 动画逐步展示
```

## 项目结构

```
myapp/
├── src/
│   └── index.js          # Worker 入口：Minimax 引擎 + KV 缓存 + HTML 模板
├── wrangler.toml          # Cloudflare Worker 配置
├── package.json           # 项目依赖
└── README.md
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动本地开发服务器（自动模拟 KV）
npx wrangler dev

# 访问 http://localhost:8787
```

> `wrangler dev` 会自动创建本地 KV 存储，无需额外配置。

## 部署到 Cloudflare

### 1. 创建 KV 命名空间

```bash
npx wrangler kv namespace create GAME_KV
```

命令会输出：

```
🌀 Creating namespace with title "tictactoe-optimal-GAME_KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "GAME_KV", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 2. 更新配置

将返回的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "GAME_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   # ← 替换为你的实际 ID
```

### 3. 部署

```bash
npx wrangler deploy
```

## 通过 Cloudflare 网页端手动部署

如果你不想使用命令行，也可以完全在 Cloudflare Dashboard 网页端完成部署。

### 第一步：创建 KV 命名空间

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧菜单选择 **Workers 和 Pages** → **KV**
3. 点击 **创建命名空间**
4. 名称填 `GAME_KV`，然后点击 **添加**
5. 记下创建后显示的 **命名空间 ID**（后面会用到）

### 第二步：创建 Worker

1. 左侧菜单选择 **Workers 和 Pages** → **概述**
2. 点击 **创建**→ 选择 **创建 Worker**
3. 给 Worker 起个名字（如 `tictactoe-optimal`），点击 **部署**
4. 部署成功后，点击 **编辑代码** 进入在线编辑器

### 第三步：粘贴代码

1. 在在线编辑器中，**全选并删除**默认代码
2. 打开本项目的 `src/index.js` 文件，**复制全部内容**
3. 粘贴到在线编辑器中
4. 点击右上角 **部署** 按钮

### 第四步：绑定 KV

1. 回到该 Worker 的页面，点击 **设置** 标签
2. 找到 **变量和机密** 部分（或在左侧选择 **绑定**）
3. 向下滚动找到 **KV 命名空间绑定**，点击 **添加**
4. **变量名称** 填写 `GAME_KV`（必须与代码中一致）
5. **KV 命名空间** 选择第一步创建的 `GAME_KV`
6. 点击 **保存并部署**

### 第五步：验证

1. 回到 Worker 概述页，找到你的 Worker URL（形如 `https://tictactoe-optimal.你的子域.workers.dev`）
2. 在浏览器中打开该 URL
3. 首次访问时 Worker 会自动计算并写入 KV 缓存，页面会显示橙色 `首次计算 → 已写入 KV` 徽章
4. 刷新页面，应看到绿色 `KV 缓存命中 ✓` 徽章，说明缓存生效

### 可选：绑定自定义域名

1. 在 Worker 设置中选择 **触发器** 标签
2. 在 **自定义域** 部分点击 **添加自定义域**
3. 输入你的域名（需已在 Cloudflare 管理 DNS）
4. Cloudflare 会自动配置 DNS 记录和 SSL 证书

> **提示**：网页端编辑器每次保存即部署，适合快速修改和调试。若需频繁迭代，建议切换到 CLI 方式（`npx wrangler deploy`）。

## 数据说明

| 指标 | 数值 |
|------|------|
| 合法局面总数 | 5,478 |
| X 胜终局 | 626 |
| O 胜终局 | 316 |
| 平局终局 | 16 |
| 进行中局面 | 4,520 |
| 完整 Minimax 查找表 | 10,956 条目 |
| 裁剪后查找表 | 3,315 条目（-70%） |
| KV 存储大小 | ~71 KB |

## 工作原理

1. **Minimax 穷举**：从空棋盘递归搜索所有可能走法，X 最大化得分，O 最小化得分
2. **记忆化**：用 `棋盘状态 + 当前轮次` 作为 key 缓存评估值，避免重复计算
3. **合法性检验**：遍历 3⁹ = 19,683 种配置，排除 X/O 数量不合理、双方同时三连等非法状态
4. **最优路径生成**：给定起始局面，每步从所有最优着法中随机选一个，生成带有多样性的最优路径
5. **最优路径裁剪**：计算完成后，从完整查找表中只保留游戏中实际可达的最优路径状态及其子节点评估值，从 10,956 裁剪至 3,315 条目
6. **KV 缓存**：裁剪后的数据持久存储在 KV，后续请求 O(1) 读取

---

# Tic-Tac-Toe · Optimal Play Explorer

> An interactive tic-tac-toe optimal strategy visualization app deployed on Cloudflare Workers.

**🌐 Live Demo: [https://tic-tac-toe.leidun.pp.ua](https://tic-tac-toe.leidun.pp.ua)**

## Overview

This project uses the **Minimax algorithm** to enumerate all legal tic-tac-toe positions (5,478 states), compute the optimal evaluation value for each state, and display the complete optimal play path with animations.

### Key Features

- **Server-side pre-computation** — The Worker runs Minimax exhaustive search on the first request, generating a complete lookup table
- **KV persistent cache** — Results are stored in Cloudflare KV; subsequent requests read directly with zero recomputation
- **Zero client-side computation** — The pre-computed table is injected into HTML; the browser only does lookups + random selection + animation rendering
- **Two game modes** — Experience optimal play from different perspectives

## Game Modes

### Mode 1: You Pick the First Move

Click any cell on the board as X's opening move. The program randomly displays a path where both sides play optimally.
The result is always a **draw** — because tic-tac-toe cannot be won under optimal play from both sides.

### Mode 2: Computer Goes First (Challenge Mode)

The computer (X) plays first at the center or a random corner. You choose O's second move:
- If you choose poorly → X wins, with hints showing which positions would have secured a draw
- If you choose correctly → Draw, with praise for your sharp eye

## Technical Architecture

```
Request → Cloudflare Worker
          ├─ Check KV cache → Hit → Inject data into HTML → Return
          └─ Cache miss → Server-side Minimax exhaustive search
                           ├─ Generate complete lookup table (10,956 entries)
                           ├─ Prune to optimal path subset (3,315 entries, -70%)
                           ├─ Count legal positions (5,478 states)
                           ├─ Async write to KV
                           └─ Inject data into HTML → Return

Browser
  ├─ Read window.__DATA__ (pruned lookup table)
  ├─ minimax() = pure table lookup O(1)
  ├─ Randomly select optimal moves to generate paths
  └─ SVG animation step-by-step display
```

## Project Structure

```
myapp/
├── src/
│   └── index.js          # Worker entry: Minimax engine + KV cache + HTML template
├── wrangler.toml          # Cloudflare Worker configuration
├── package.json           # Project dependencies
└── README.md
```

## Local Development

```bash
# Install dependencies
npm install

# Start local dev server (auto-simulates KV)
npx wrangler dev

# Visit http://localhost:8787
```

> `wrangler dev` automatically creates local KV storage — no extra configuration needed.

## Deploy to Cloudflare

### 1. Create KV Namespace

```bash
npx wrangler kv namespace create GAME_KV
```

The command will output:

```
🌀 Creating namespace with title "tictactoe-optimal-GAME_KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "GAME_KV", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 2. Update Configuration

Paste the returned `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "GAME_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   # ← Replace with your actual ID
```

### 3. Deploy

```bash
npx wrangler deploy
```

## Deploy via Cloudflare Dashboard (Manual)

If you prefer not to use the command line, you can deploy entirely through the Cloudflare Dashboard.

### Step 1: Create KV Namespace

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. In the left menu, select **Workers & Pages** → **KV**
3. Click **Create a namespace**
4. Enter `GAME_KV` as the name, then click **Add**
5. Note the **Namespace ID** shown after creation (you'll need it later)

### Step 2: Create Worker

1. In the left menu, select **Workers & Pages** → **Overview**
2. Click **Create** → Choose **Create Worker**
3. Name your Worker (e.g., `tictactoe-optimal`), click **Deploy**
4. After deployment, click **Edit code** to open the online editor

### Step 3: Paste Code

1. In the online editor, **select all and delete** the default code
2. Open this project's `src/index.js` file, **copy all contents**
3. Paste into the online editor
4. Click the **Deploy** button in the top right

### Step 4: Bind KV

1. Go back to the Worker's page, click the **Settings** tab
2. Find the **Variables and Secrets** section (or select **Bindings** in the left menu)
3. Scroll down to **KV Namespace Bindings**, click **Add**
4. Set **Variable name** to `GAME_KV` (must match the code)
5. Select the `GAME_KV` namespace created in Step 1 for **KV Namespace**
6. Click **Save and Deploy**

### Step 5: Verify

1. Go to the Worker overview page and find your Worker URL (e.g., `https://tictactoe-optimal.your-subdomain.workers.dev`)
2. Open the URL in your browser
3. On the first visit, the Worker will automatically compute and write to KV cache — the page will show an orange `First computation → Written to KV` badge
4. Refresh the page — you should see a green `KV Cache Hit ✓` badge, confirming the cache is working

### Optional: Bind Custom Domain

1. In Worker settings, select the **Triggers** tab
2. Under **Custom Domains**, click **Add Custom Domain**
3. Enter your domain (must already have DNS managed by Cloudflare)
4. Cloudflare will automatically configure DNS records and SSL certificates

> **Tip**: The web editor deploys on every save — great for quick edits and debugging. For frequent iterations, consider switching to CLI (`npx wrangler deploy`).

## Data Summary

| Metric | Value |
|--------|-------|
| Total legal positions | 5,478 |
| X-win terminal states | 626 |
| O-win terminal states | 316 |
| Draw terminal states | 16 |
| In-progress states | 4,520 |
| Full Minimax lookup table | 10,956 entries |
| Pruned lookup table | 3,315 entries (-70%) |
| KV storage size | ~71 KB |

## How It Works

1. **Minimax exhaustive search**: Recursively explores all possible moves from the empty board — X maximizes score, O minimizes score
2. **Memoization**: Uses `board state + current turn` as a cache key for evaluation values, avoiding redundant computation
3. **Legality checking**: Iterates through 3⁹ = 19,683 configurations, filtering out states with invalid X/O counts or simultaneous three-in-a-rows
4. **Optimal path generation**: Given a starting position, randomly selects among optimal moves at each step, creating diverse optimal paths
5. **Optimal path pruning**: After full computation, retains only game-reachable optimal path states and their child evaluation values from the complete lookup table, reducing from 10,956 to 3,315 entries
6. **KV caching**: Pruned data is persistently stored in KV; subsequent requests are O(1) reads
