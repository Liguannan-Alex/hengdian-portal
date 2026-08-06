# 门户后端 v0.2

为 `hengdian-portal` 提供真实身份、跨设备收藏、工具点击埋点、运营统计，
以及 **AI 工作流编排层**（v0.2 新增）。

前端 v0.3 是纯前端站点，档案与收藏存在浏览器 `localStorage`，换设备即丢失，也无法产出运营数据。本服务补上这一层。

## 为什么先做这些

门户 PRD v0.2 的 90 天成功标准与系统门禁直接决定了本期范围：

| PRD 要求 | 对应实现 |
| --- | --- |
| 完成身份注册的用户 ≥ 50 | `users` 表 + `/api/auth/*` |
| 至少点过 1 次工具的用户占比 ≥ 60% | `tool_events` 表 + `/api/stats/weekly` |
| 周报能自动出数（身份分布、工具 Top、交叉表） | `/api/stats/weekly` 与 `weekly.csv` |
| 埋点字段完整率 ≥ 95%，无埋点不上线 | `/api/events` 强校验 + `/api/events/completeness` 自检 |

v0.2 在此之上加了工作流编排层。它回答的是另一个问题：门户能不能不只是导航，
而是让人在站内把活干出来。工具点击证明「有人来看」，工作流任务证明「有人用它产出了东西」——
后者才是能拿去汇报的证据。

编排层严格停在 PRD 的边界内：**不自建 GPU、不做算力调度**，只做派单、排队、配额与产出归属，
真正的计算在第三方。换供应商时只新增一个 provider 实现，队列、路由、前端都不动。

埋点是本期第一优先级。缺必填字段的上报直接拒收并返回缺失项，不做静默补空，否则完整率会被自动填充的空值抬高，门禁失去意义。

## 技术选型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 运行时 | Node ≥ 22.5 | 使用内置 `node:sqlite` 与 `--experimental-strip-types`，直接跑 TypeScript |
| 框架 | Hono | 同一份代码可跑在 Node、Cloudflare Workers 与 Vercel，换部署目标不必重写路由 |
| 数据库 | SQLite（`node:sqlite`） | 零原生编译依赖。按 PRD 的 50 人量级，SQLite 足够 |
| 口令 | `node:crypto` scrypt | 标准库实现，无需 bcrypt/argon2 的编译步骤 |
| 会话 | httpOnly Cookie + 服务端会话表 | 需要「关闭档案即刻失效」和管理员停用账号，服务端可撤销的会话表比 JWT 直接 |

| 任务队列 | 进程内 + SQLite 落库 | 队列深度以十为单位，引入 Redis/BullMQ 会多一个要运维的部件。状态全在库里，进程重启不丢单 |
| 算力 | 第三方 provider 适配层 | PRD 明确不做 GPU 调度。`submit` / `poll` 二段式接口，换供应商只加一个实现 |

生产依赖只有 `hono` 与 `@hono/node-server` 两个。

## 本地运行

```bash
cd server
npm install
cp .env.example .env          # 按需修改
npm run seed:tools            # 把前端 473 条工具底表同步进库
npm run seed:workflows        # 把工作流定义快照同步进库（服务启动时也会自动执行）
npm run dev                   # http://localhost:8787
```

单元测试：

```bash
npm test
```

冒烟测试（改动后端后必跑）：

```bash
bash scripts/smoke.sh
```

当前 44 项全部通过。本机若开启系统代理，`curl` 需要 `--noproxy '*'`，脚本已带。

## 本地常驻部署（macOS）

用 launchd 注册为后台服务，开机自启，进程异常退出会自动拉起。

```bash
bash scripts/local-service.sh install    # 安装并启动
bash scripts/local-service.sh status     # 状态与健康检查
bash scripts/local-service.sh restart    # 改完代码用这个
bash scripts/local-service.sh logs       # 跟踪日志
bash scripts/local-service.sh stop       # 停止
bash scripts/local-service.sh uninstall  # 移除服务定义，不删数据库
```

服务定义写入 `~/Library/LaunchAgents/com.hengdian.portal-server.plist`，
日志在 `server/logs/`，数据库在 `server/data/portal.db`。

注意：`scripts/smoke.sh` 会向当前运行的服务写入测试账号与测试事件。
需要恢复干净状态时：

```bash
bash scripts/local-service.sh stop
rm -f data/portal.db*
DB_PATH="$PWD/data/portal.db" node --experimental-strip-types scripts/sync-tools.ts
bash scripts/local-service.sh start
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 8787 | 监听端口 |
| `DB_PATH` | `data/portal.db` | SQLite 文件位置 |
| `ALLOWED_ORIGINS` | 本地 5173 | 允许携带 Cookie 的前端来源，逗号分隔 |
| `COOKIE_SECURE` | `true` | 本地 http 开发置 `false`；线上必须为 `true` |
| `ADMIN_USERNAMES` | 空 | 可访问 `/api/stats` 的管理员用户名，逗号分隔。未设置时统计接口对所有账号返回 403 |

工作流编排层：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `WORKFLOW_ALLOW_MOCK` | `true` | 演示算力开关。未接入的算力回落到占位产出。**线上必须置为 `false`**，否则用户会把占位图当成真实产出 |
| `WORKFLOW_MOCK_DELAY_MS` | 1500 | 演示算力的模拟等待 |
| `WORKFLOW_CONCURRENCY` | 2 | 同时在跑的任务数上限。每个在跑任务都对应第三方计费 |
| `WORKFLOW_DAILY_CREDITS` | 30 | 每人每日额度，按工作流 `costCredits` 累加 |
| `WORKFLOW_PENDING_LIMIT` | 3 | 同一用户未完成任务数上限 |
| `WORKFLOW_RUN_TIMEOUT_SECONDS` | 600 | 单任务最长执行时间 |
| `WORKFLOW_POLL_INTERVAL_SECONDS` | 5 | 轮询第三方作业状态的间隔 |
| `WORKFLOW_TICK_INTERVAL_SECONDS` | 2 | 队列扫描间隔 |
| `WORKFLOWS_PATH` | `../src/data/workflows.json` | 工作流定义文件位置 |
| `WORKFLOW_LIBLIB_*` | 空 | 第三方算力凭据与字段映射，见 `.env.example` |

`local-service.sh` 会读取 `.env` 再写进 launchd plist，`restart` 也会重写 plist，
所以改完 `.env` 直接 `restart` 即可生效。

## 接口

路径带不带尾斜杠都可以，服务端以 308 归一（308 保留请求方法与请求体）。

### 身份

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 用户名、口令、显示名称、身份、单位。身份取 `opc` / `crew` / `director` / `individual` |
| POST | `/api/auth/login` | 登录。同一用户名连续失败 8 次锁定 10 分钟 |
| POST | `/api/auth/logout` | 当前设备登出 |
| POST | `/api/auth/logout-all` | 全部设备登出，用于口令泄露后的自助处置 |
| GET | `/api/auth/me` | 当前用户，未登录返回 `user: null` |

口令要求 8 至 128 位且同时含字母与数字。用户名为 3 至 32 位字母、数字、下划线或连字符。

### 收藏

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/favorites` | 当前用户收藏的工具 ID 列表 |
| PUT | `/api/favorites/:toolId` | 切换收藏状态，返回 `favorited` |
| POST | `/api/favorites/merge` | 合并本机收藏。前端首次登录时把 `localStorage` 里的记录一次性带上来，最多 500 条 |

### 埋点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/events` | 上报事件 |
| GET | `/api/events/completeness` | 字段完整率自检，可带 `since` |

`action` 取值与必填字段：

| action | 必填 |
| --- | --- |
| `tool_click` | `toolId`、`toolName`、`sourcePage` |
| `tool_view` | `toolId`、`sourcePage` |
| `search` | `keyword`、`sourcePage` |
| `favorite_add` / `favorite_remove` | `toolId`、`sourcePage` |
| `workflow_view` / `workflow_submit` | `workflowSlug`、`sourcePage` |
| `workflow_finish` | `workflowSlug`、`sourcePage`、`keyword`（终态） |

`workflow_finish` 由服务端在任务进入终态时补记，`sourcePage` 记为 `server`。
完整率 SQL 同步覆盖了这三个新动作——只加动作不改完整率判据，会让门禁在新功能上失效。

可选字段 `scene` 用于身份×场景交叉表。未登录也可上报，此时 `user_id` 为空、`identity` 记为 `anonymous`。

### 工作流

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/workflows` | 全部工作流定义，附当下算力是否可用 |
| GET | `/api/workflows/:slug` | 单条定义 |
| GET | `/api/workflows/quota` | 当前用户今日额度与队列占用 |
| POST | `/api/workflows/:slug/runs` | 提交任务。参数校验失败返回 `fieldErrors`（逐字段） |
| GET | `/api/workflows/runs` | 我的任务列表，可带 `status` / `limit` |
| GET | `/api/workflows/runs/:id` | 单个任务与产出 |
| POST | `/api/workflows/runs/:id/cancel` | 取消排队或执行中的任务 |

提交路径上有三道闸，缺一不可：

1. **必须登录**——匿名产生的算力费用无法归属，也无法做配额。
2. **参数服务端权威校验**——前端也按同一份定义校验，但那只是体验；越界参数直接变成账单。
   定义之外的键一律拒收，不透传给算力方。
3. **每日额度 + 未完成任务上限**——防止一次误操作把额度打空。

任务状态机：`queued` → `running` → `succeeded` / `failed` / `canceled`。
任务状态落在 SQLite，进程重启后会把心跳超时的 `running` 放回队列；
已拿到第三方作业号的接着轮询，没拿到的重新提交。

只能看到自己的任务：产出可能包含剧本片段等项目内容，不做跨用户可见。
用别人的任务号查询返回 404 而不是 403，避免用任务号探测他人任务是否存在。

### 统计（需管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats/weekly` | 三个考核指标、身份分布、工具 Top 20、身份×场景交叉、搜索词、按日趋势。可带 `since` / `until` |
| GET | `/api/stats/weekly.csv` | 工具点击榜导出，带 BOM，Excel 打开不乱码 |
| GET | `/api/stats/weekly-workflows.csv` | 工作流运行榜导出 |

`/api/stats/weekly` 的 `workflows` 段给出运行次数、去重用户、成功率与额度消耗。
成功率的分母排除用户主动取消——取消是用户决定，不是系统失败。

## 隐私口径

- 不落原始 User-Agent 与 IP，只存 SHA-256 前 32 位散列。
- 口令只存 scrypt 散列，格式 `scrypt$N$r$p$salt$hash`。
- 会话表存 UA 前 300 字符用于用户自查登录设备，可按需去掉。
- 用户不存在时登录仍执行一次散列校验，避免通过响应时间区分账号是否存在。

## 尚未处理

1. **部署位置未定**。前端在 GitHub Pages，静态托管无法运行后端。前后端分离部署需要确定后端落点并配置 `ALLOWED_ORIGINS` 与 `COOKIE_SECURE=true`。
2. **前端只接入了工作流一条链路**。`src/lib/auth.tsx`（本机档案、收藏）仍是 `localStorage` 实现；
   工作流走 `src/lib/portalApi.ts` + `src/lib/serverAccount.tsx` 的服务端账号。
   两套身份并存是有意的：本机档案明确承诺无密码、不上传，工作流则必须能归属费用，安全承诺不同。
   合并两者需要改掉本机档案的对外口径，属于产品决策，未在本期内顺手做掉。
   合并时的接入方式仍为保持 `AuthContextValue` 接口不变、替换内部实现，页面组件不需要改动。
3. 登录失败计数存在进程内存，多实例部署需换成共享存储。
4. 无管理后台界面，工具数据仍以前端 `src/data/tools.json` 为唯一来源，通过 `npm run seed:tools` 同步。
5. 无找回口令流程。
6. 未接入横店统一身份认证。
7. **`liblib` provider 的字段映射尚未与厂商接口文档逐字段核对**。它按「提交返回作业号、
   轮询返回状态与产出」的通用形态写成、由环境变量驱动；接入前必须拿到对方接口契约核对后再启用。
   未配凭据时该 provider 报告为未接入，工作流不接受提交，不会产生「提交后才发现字段对不上」的失败单。
8. 工作流参考图只接受公网 http(s) 链接，尚不支持本地文件上传。
9. 产出链接由算力方托管，可能有有效期；门户不转存、不做产出资产库。
10. 队列是进程内的，多实例部署会重复派单。届时需要把 `claim` 换成跨实例的抢占方式。

## 数据表

| 表 | 用途 |
| --- | --- |
| `users` | 账号、口令散列、显示名称、身份、单位、停用标记 |
| `sessions` | 会话令牌、过期时间，可撤销 |
| `favorites` | 用户与工具的收藏关系 |
| `tool_events` | 埋点主表，周报与完整率的数据来源 |
| `tools` | 工具名称快照，供埋点补名与周报展示 |
| `workflows` | 工作流定义快照，供周报按名称汇总 |
| `workflow_runs` | 工作流任务：参数、状态、产出、额度消耗、心跳 |
