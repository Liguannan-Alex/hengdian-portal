/**
 * 把前端 src/data/tools.json 的来源底表同步进后端 tools 表。
 *
 * 后端只需要 id、name、category、url、scenes 五个字段，用于埋点时补全工具名称
 * 与周报展示。工具数据的唯一来源仍是前端 JSON，本表不做人工编辑。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDb, closeDb } from '../src/db.ts'

interface SourceTool {
  id: number
  name: string
  category?: string
  url?: string
  scenes?: string[]
}

const source = resolve(import.meta.dirname, '../../src/data/tools.json')
const raw: unknown = JSON.parse(readFileSync(source, 'utf8'))

if (!Array.isArray(raw)) {
  console.error('tools.json 不是数组，已终止')
  process.exit(1)
}

const db = getDb()
const upsert = db.prepare(
  `INSERT INTO tools (id, name, category, url, scenes) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category,
     url = excluded.url, scenes = excluded.scenes`,
)

let ok = 0
let skipped = 0

db.exec('BEGIN')
try {
  for (const item of raw as SourceTool[]) {
    if (typeof item?.id !== 'number' || typeof item?.name !== 'string') {
      skipped += 1
      continue
    }
    upsert.run(
      item.id,
      item.name,
      item.category ?? null,
      item.url ?? null,
      Array.isArray(item.scenes) ? item.scenes.join(',') : null,
    )
    ok += 1
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

const total = (db.prepare('SELECT COUNT(*) AS n FROM tools').get() as { n: number }).n
console.log(`同步完成：写入 ${ok} 条，跳过 ${skipped} 条，当前库内共 ${total} 条`)
closeDb()
