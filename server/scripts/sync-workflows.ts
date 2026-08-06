/**
 * 把前端 src/data/workflows.json 的工作流定义快照同步进后端 workflows 表。
 *
 * 定义的唯一来源仍是前端 JSON；本表只是快照，供周报按名称汇总，
 * 以及在定义文件临时不可读时仍能显示历史任务的工作流名称。
 */
import { closeDb } from '../src/db.ts'
import { syncWorkflows } from '../src/workflow/definitions.ts'

const count = syncWorkflows()
console.log(`工作流定义同步完成：${count} 条`)
closeDb()
