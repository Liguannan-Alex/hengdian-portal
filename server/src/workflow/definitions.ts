/**
 * 工作流定义的后端读取层。
 *
 * 唯一来源仍是前端 `src/data/workflows.json`，与工具底表同一套约定：
 * 数据在前端仓库里评审，后端只读不改。定义在进程启动时载入内存，
 * 同时快照进 `workflows` 表，供周报按名称汇总，避免统计依赖运行时文件。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDb, nowIso } from '../db.ts'

export type InputType = 'text' | 'textarea' | 'select' | 'number' | 'toggle' | 'image_url'
export type OutputKind = 'image' | 'video' | 'text'

export interface WorkflowInput {
  key: string
  label: string
  type: InputType
  required: boolean
  /** 'canvas' 表示由画布填入，界面不渲染。服务端仍照常校验。 */
  supplied?: 'canvas'
  help?: string
  placeholder?: string
  default?: string | number | boolean
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
}

export interface WorkflowDefinition {
  slug: string
  name: string
  sceneSlug: string
  /** library：列表里露出；canvas：画布操作，不进列表。 */
  surface: 'library' | 'canvas'
  summary: string
  description: string
  provider: string
  providerRef: string
  outputKind: OutputKind
  estimatedSeconds: number
  costCredits: number
  relatedToolIds: number[]
  inputs: WorkflowInput[]
}

interface WorkflowsFile {
  version: number
  updatedAt: string
  workflows: WorkflowDefinition[]
}

const DEFAULT_SOURCE = resolve(import.meta.dirname, '../../../src/data/workflows.json')

let cache: WorkflowDefinition[] | null = null
let cacheBySlug: Map<string, WorkflowDefinition> | null = null

function sourcePath(): string {
  return process.env.WORKFLOWS_PATH ? resolve(process.env.WORKFLOWS_PATH) : DEFAULT_SOURCE
}

/**
 * 读取定义文件。
 *
 * 结构性错误在这里直接抛出：定义文件坏掉时宁可启动失败，也不要带着
 * 半份工作流对外提供服务，让用户提交后才发现字段对不上。
 */
export function loadDefinitions(force = false): WorkflowDefinition[] {
  if (cache && !force) return cache

  const raw: unknown = JSON.parse(readFileSync(sourcePath(), 'utf8'))
  const file = raw as WorkflowsFile
  if (!file || !Array.isArray(file.workflows) || file.workflows.length === 0) {
    throw new Error(`工作流定义文件无效：${sourcePath()}`)
  }
  for (const workflow of file.workflows) {
    if (!workflow.slug || !Array.isArray(workflow.inputs) || workflow.inputs.length === 0) {
      throw new Error(`工作流定义缺少 slug 或 inputs：${workflow.slug ?? '(未知)'}`)
    }
  }

  cache = file.workflows
  cacheBySlug = new Map(file.workflows.map((workflow) => [workflow.slug, workflow]))
  return cache
}

export function definitionBySlug(slug: string): WorkflowDefinition | null {
  if (!cacheBySlug) loadDefinitions()
  return cacheBySlug?.get(slug) ?? null
}

/** 把定义快照写进 workflows 表。启动与 seed 脚本都会调用，可重复执行。 */
export function syncWorkflows(): number {
  const definitions = loadDefinitions(true)
  const db = getDb()
  const upsert = db.prepare(
    `INSERT INTO workflows
       (slug, name, scene_slug, provider, provider_ref, output_kind, cost_credits, estimated_seconds, definition, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name, scene_slug = excluded.scene_slug, provider = excluded.provider,
       provider_ref = excluded.provider_ref, output_kind = excluded.output_kind,
       cost_credits = excluded.cost_credits, estimated_seconds = excluded.estimated_seconds,
       definition = excluded.definition, synced_at = excluded.synced_at`,
  )

  db.exec('BEGIN')
  try {
    for (const workflow of definitions) {
      upsert.run(
        workflow.slug,
        workflow.name,
        workflow.sceneSlug,
        workflow.provider,
        workflow.providerRef,
        workflow.outputKind,
        workflow.costCredits,
        workflow.estimatedSeconds,
        JSON.stringify(workflow),
        nowIso(),
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  // 定义文件删掉的工作流不从表里删除：历史任务仍要按 slug 显示名称。
  return definitions.length
}
