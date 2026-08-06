/**
 * 运营统计路由：直接产出门户 PRD v0.2 的三个考核数字与周报表格。
 *
 * PRD 90 天成功标准：
 *   1. 完成身份注册的用户 ≥ 50
 *   2. 至少点过 1 次工具的用户占比 ≥ 60%
 *   3. 周报能自动出数（身份分布、工具 Top、交叉表）
 *
 * 本路由只读，不改数据。访问需管理员身份，管理员名单由环境变量
 * ADMIN_USERNAMES 以逗号分隔配置。
 */
import { Hono } from 'hono'
import { getDb } from '../db.ts'
import { currentUser } from '../lib/session.ts'

export const statsRoutes = new Hono()

const IDENTITY_LABEL: Record<string, string> = {
  opc: '一人公司',
  crew: '剧组',
  director: '导演',
  individual: '个人',
  anonymous: '未登录',
}

function isAdmin(username: string): boolean {
  const list = (process.env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(username.toLowerCase())
}

statsRoutes.use('*', async (c, next) => {
  const user = currentUser(c)
  if (!user) return c.json({ ok: false, error: '未登录' }, 401)
  if (!isAdmin(user.username)) return c.json({ ok: false, error: '需要管理员权限' }, 403)
  await next()
})

/** 周报主接口。默认统计最近 7 天，可用 since / until 覆盖。 */
statsRoutes.get('/weekly', (c) => {
  const until = c.req.query('until') ?? new Date().toISOString()
  const since = c.req.query('since') ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const db = getDb()

  const totalUsers = (db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled = 0').get() as { n: number }).n
  const newUsers = (
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?').get(since, until) as {
      n: number
    }
  ).n

  // 指标二的分子：区间内产生过工具类行为的注册用户数。
  const activeUsers = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS n FROM tool_events
         WHERE user_id IS NOT NULL AND occurred_at >= ? AND occurred_at < ?
           AND action IN ('tool_click','favorite_add')`,
      )
      .get(since, until) as { n: number }
  ).n

  // 累计口径：历史上任意时间点用过工具的注册用户，用于对照 PRD 的 60% 门槛。
  const everActiveUsers = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT user_id) AS n FROM tool_events
         WHERE user_id IS NOT NULL AND action IN ('tool_click','favorite_add')`,
      )
      .get() as { n: number }
  ).n

  const identityRows = db
    .prepare('SELECT identity, COUNT(*) AS n FROM users WHERE disabled = 0 GROUP BY identity ORDER BY n DESC')
    .all() as { identity: string; n: number }[]

  const topTools = db
    .prepare(
      `SELECT tool_id, COALESCE(MAX(tool_name), '未记录名称') AS tool_name,
              COUNT(*) AS clicks, COUNT(DISTINCT user_id) AS users
       FROM tool_events
       WHERE action = 'tool_click' AND occurred_at >= ? AND occurred_at < ? AND tool_id IS NOT NULL
       GROUP BY tool_id ORDER BY clicks DESC LIMIT 20`,
    )
    .all(since, until) as { tool_id: number; tool_name: string; clicks: number; users: number }[]

  // 交叉表：身份 × 场景。
  const crossRows = db
    .prepare(
      `SELECT identity, COALESCE(scene, '未标注') AS scene, COUNT(*) AS n
       FROM tool_events
       WHERE action = 'tool_click' AND occurred_at >= ? AND occurred_at < ?
       GROUP BY identity, scene ORDER BY n DESC`,
    )
    .all(since, until) as { identity: string; scene: string; n: number }[]

  const topKeywords = db
    .prepare(
      `SELECT keyword, COUNT(*) AS n FROM tool_events
       WHERE action = 'search' AND occurred_at >= ? AND occurred_at < ? AND keyword IS NOT NULL
       GROUP BY keyword ORDER BY n DESC LIMIT 20`,
    )
    .all(since, until) as { keyword: string; n: number }[]

  const dailyRows = db
    .prepare(
      `SELECT substr(occurred_at, 1, 10) AS day, COUNT(*) AS events, COUNT(DISTINCT user_id) AS users
       FROM tool_events WHERE occurred_at >= ? AND occurred_at < ?
       GROUP BY day ORDER BY day`,
    )
    .all(since, until) as { day: string; events: number; users: number }[]

  const activeRatio = totalUsers === 0 ? null : Number(((everActiveUsers / totalUsers) * 100).toFixed(2))

  // 工作流口径：从「点了哪个工具」升级到「在门户里跑出了什么」，是本期新增的证据。
  const runStatusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM workflow_runs WHERE created_at >= ? AND created_at < ?
       GROUP BY status ORDER BY n DESC`,
    )
    .all(since, until) as { status: string; n: number }[]

  const topWorkflows = db
    .prepare(
      `SELECT workflow_slug, COALESCE(MAX(workflow_name), workflow_slug) AS workflow_name,
              COUNT(*) AS runs, COUNT(DISTINCT user_id) AS users,
              SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
              SUM(cost_credits) AS credits
       FROM workflow_runs WHERE created_at >= ? AND created_at < ?
       GROUP BY workflow_slug ORDER BY runs DESC LIMIT 20`,
    )
    .all(since, until) as {
    workflow_slug: string
    workflow_name: string
    runs: number
    users: number
    succeeded: number
    credits: number
  }[]

  const runUsers = (
    db
      .prepare(
        'SELECT COUNT(DISTINCT user_id) AS n FROM workflow_runs WHERE created_at >= ? AND created_at < ?',
      )
      .get(since, until) as { n: number }
  ).n

  const totalRuns = runStatusRows.reduce((sum, row) => sum + row.n, 0)
  const succeededRuns = runStatusRows.find((row) => row.status === 'succeeded')?.n ?? 0
  // 成功率分母排除用户主动取消：取消是用户决定，不是系统失败。
  const canceledRuns = runStatusRows.find((row) => row.status === 'canceled')?.n ?? 0
  const judgedRuns = totalRuns - canceledRuns
  const successRate = judgedRuns === 0 ? null : Number(((succeededRuns / judgedRuns) * 100).toFixed(2))

  return c.json({
    ok: true,
    range: { since, until },
    // 三个考核指标，直接对照 PRD 的及格线
    indicators: {
      registeredUsers: { value: totalUsers, target: 50, passed: totalUsers >= 50 },
      everActiveRatioPercent: { value: activeRatio, target: 60, passed: activeRatio === null ? null : activeRatio >= 60 },
      reportAutoGenerated: { value: true, target: true, passed: true },
    },
    summary: {
      totalUsers,
      newUsersInRange: newUsers,
      activeUsersInRange: activeUsers,
      everActiveUsers,
    },
    identityDistribution: identityRows.map((r) => ({
      identity: r.identity,
      label: IDENTITY_LABEL[r.identity] ?? r.identity,
      count: r.n,
    })),
    topTools,
    identitySceneCross: crossRows.map((r) => ({
      identity: r.identity,
      label: IDENTITY_LABEL[r.identity] ?? r.identity,
      scene: r.scene,
      count: r.n,
    })),
    topKeywords,
    daily: dailyRows,
    workflows: {
      totalRuns,
      runUsers,
      succeededRuns,
      canceledRuns,
      successRatePercent: successRate,
      creditsSpent: topWorkflows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0),
      byStatus: runStatusRows,
      top: topWorkflows,
    },
  })
})

/** 工作流运行榜导出，与工具点击榜分开，两张表在汇报里回答不同的问题。 */
statsRoutes.get('/weekly-workflows.csv', (c) => {
  const until = c.req.query('until') ?? new Date().toISOString()
  const since = c.req.query('since') ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

  const rows = getDb()
    .prepare(
      `SELECT workflow_slug, COALESCE(MAX(workflow_name), workflow_slug) AS workflow_name,
              COUNT(*) AS runs, COUNT(DISTINCT user_id) AS users,
              SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(cost_credits) AS credits
       FROM workflow_runs WHERE created_at >= ? AND created_at < ?
       GROUP BY workflow_slug ORDER BY runs DESC`,
    )
    .all(since, until) as {
    workflow_slug: string
    workflow_name: string
    runs: number
    users: number
    succeeded: number
    failed: number
    credits: number
  }[]

  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [
    ['工作流', '名称', '运行次数', '去重用户数', '成功', '失败', '消耗额度'].map(escape).join(','),
    ...rows.map((r) =>
      [r.workflow_slug, r.workflow_name, r.runs, r.users, r.succeeded, r.failed, r.credits]
        .map(escape)
        .join(','),
    ),
  ]

  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="portal-workflows-${since.slice(0, 10)}.csv"`,
    },
  })
})

/** 导出为 CSV，便于直接贴进汇报材料。 */
statsRoutes.get('/weekly.csv', (c) => {
  const until = c.req.query('until') ?? new Date().toISOString()
  const since = c.req.query('since') ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const db = getDb()

  const rows = db
    .prepare(
      `SELECT tool_id, COALESCE(MAX(tool_name), '') AS tool_name, COUNT(*) AS clicks,
              COUNT(DISTINCT user_id) AS users
       FROM tool_events
       WHERE action = 'tool_click' AND occurred_at >= ? AND occurred_at < ? AND tool_id IS NOT NULL
       GROUP BY tool_id ORDER BY clicks DESC`,
    )
    .all(since, until) as { tool_id: number; tool_name: string; clicks: number; users: number }[]

  const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [
    ['工具ID', '工具名称', '点击次数', '去重用户数'].map(escape).join(','),
    ...rows.map((r) => [r.tool_id, r.tool_name, r.clicks, r.users].map(escape).join(',')),
  ]

  // 加 BOM，Excel 打开不乱码。
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="portal-weekly-${since.slice(0, 10)}.csv"`,
    },
  })
})
