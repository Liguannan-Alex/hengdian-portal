# 门户后端 v0.1

为 `hengdian-portal` 提供真实身份、跨设备收藏、工具点击埋点与运营统计。

前端 v0.3 是纯前端站点，档案与收藏存在浏览器 `localStorage`，换设备即丢失，也无法产出运营数据。本服务补上这一层。

## 为什么先做这些

门户 PRD v0.2 的 90 天成功标准与系统门禁直接决定了本期范围：

| PRD 要求 | 对应实现 |
| --- | --- |
| 完成身份注册的用户 ≥ 50 | `users` 表 + `/api/auth/*` |
| 至少点过 1 次工具的用户占比 ≥ 60% | `tool_events` 表 + `/api/stats/weekly` |
| 周报能自动出数（身份分布、工具 Top、交叉表） | `/api/stats/weekly` 与 `weekly.csv` |
| 埋点字段完整率 ≥ 95%，无埋点不上线 | `/api/events` 强校验 + `/api/events/completeness` 自检 |

埋点是本期第一优先级。缺必填字段的上报直接拒收并返回缺失项，不做静默补空，否则完整率会被自动填充的空值抬高，门禁失去意义。

## 技术选型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 运行时 | Node ≥ 22.5 | 使用内置 `node:sqlite` 与 `--experimental-strip-types`，直接跑 TypeScript |
| 框架 | Hono | 同一份代码可跑在 Node、Cloudflare Workers 与 Vercel，换部署目标不必重写路由 |
| 数据库 | SQLite（`node:sqlite`） | 零原生编译依赖。按 PRD 的 50 人量级，SQLite 足够 |
| 口令 | `node:crypto` scrypt | 标准库实现，无需 bcrypt/argon2 的编译步骤 |
| 会话 | httpOnly Cookie + 服务端会话表 | 需要「关闭档案即刻失效」和管理员停用账号，服务端可撤销的会话表比 JWT 直接 |

生产依赖只有 `hono` 与 `@hono/node-server` 两个。

## 本地运行

```bash
cd server
npm install
cp .env.example .env          # 按需修改
npm run seed:tools            # 把前端 473 条工具底表同步进库
npm run dev                   # http://localhost:8787
```

冒烟测试（改动后端后必跑）：

```bash
bash scripts/smoke.sh
```

当前 26 项全部通过。本机若开启系统代理，`curl` 需要 `--noproxy '*'`，脚本已带。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 8787 | 监听端口 |
| `DB_PATH` | `data/portal.db` | SQLite 文件位置 |
| `ALLOWED_ORIGINS` | 本地 5173 | 允许携带 Cookie 的前端来源，逗号分隔 |
| `COOKIE_SECURE` | `true` | 本地 http 开发置 `false`；线上必须为 `true` |
| `ADMIN_USERNAMES` | 空 | 可访问 `/api/stats` 的管理员用户名，逗号分隔。未设置时统计接口对所有账号返回 403 |

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

可选字段 `scene` 用于身份×场景交叉表。未登录也可上报，此时 `user_id` 为空、`identity` 记为 `anonymous`。

### 统计（需管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats/weekly` | 三个考核指标、身份分布、工具 Top 20、身份×场景交叉、搜索词、按日趋势。可带 `since` / `until` |
| GET | `/api/stats/weekly.csv` | 工具点击榜导出，带 BOM，Excel 打开不乱码 |

## 隐私口径

- 不落原始 User-Agent 与 IP，只存 SHA-256 前 32 位散列。
- 口令只存 scrypt 散列，格式 `scrypt$N$r$p$salt$hash`。
- 会话表存 UA 前 300 字符用于用户自查登录设备，可按需去掉。
- 用户不存在时登录仍执行一次散列校验，避免通过响应时间区分账号是否存在。

## 尚未处理

1. **部署位置未定**。前端在 GitHub Pages，静态托管无法运行后端。前后端分离部署需要确定后端落点并配置 `ALLOWED_ORIGINS` 与 `COOKIE_SECURE=true`。
2. **前端尚未接入**。`src/lib/auth.tsx` 仍是 `localStorage` 实现。接入方式为保持 `AuthContextValue` 接口不变、替换内部实现，页面组件不需要改动。
3. 登录失败计数存在进程内存，多实例部署需换成共享存储。
4. 无管理后台界面，工具数据仍以前端 `src/data/tools.json` 为唯一来源，通过 `npm run seed:tools` 同步。
5. 无找回口令流程。
6. 未接入横店统一身份认证。

## 数据表

| 表 | 用途 |
| --- | --- |
| `users` | 账号、口令散列、显示名称、身份、单位、停用标记 |
| `sessions` | 会话令牌、过期时间，可撤销 |
| `favorites` | 用户与工具的收藏关系 |
| `tool_events` | 埋点主表，周报与完整率的数据来源 |
| `tools` | 工具名称快照，供埋点补名与周报展示 |
