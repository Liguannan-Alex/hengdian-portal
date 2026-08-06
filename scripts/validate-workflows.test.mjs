import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkflowData, validateWorkflowData } from './validate-workflows.mjs'

test('当前工作流定义满足 v0.1 编排层契约', async () => {
  const { workflows, tools } = await loadWorkflowData()
  const result = validateWorkflowData(workflows, tools)

  assert.deepEqual(result.errors, [])
  assert.equal(result.summary.workflows, workflows.workflows.length)
  assert.ok(result.summary.workflows >= 5)
  assert.ok(result.summary.coveredScenes.includes('video-generation'))
  assert.ok(result.summary.outputKinds.every((kind) => ['image', 'video', 'text'].includes(kind)))
})

test('关联到不存在的工具 ID 会被拒绝', async () => {
  const { workflows, tools } = await loadWorkflowData()
  const clone = structuredClone(workflows)
  clone.workflows[0].relatedToolIds = [999999]

  const result = validateWorkflowData(clone, tools)
  assert.ok(result.errors.some((error) => error.includes('关联了不存在的工具 ID 999999')))
})

test('数字字段缺少上限会被拒绝', async () => {
  const { workflows, tools } = await loadWorkflowData()
  const clone = structuredClone(workflows)
  const target = clone.workflows
    .flatMap((workflow) => workflow.inputs)
    .find((input) => input.type === 'number')
  delete target.max

  const result = validateWorkflowData(clone, tools)
  assert.ok(result.errors.some((error) => error.includes('必须同时声明 min 与 max')))
})

test('文本字段缺少 maxLength 会被拒绝', async () => {
  const { workflows, tools } = await loadWorkflowData()
  const clone = structuredClone(workflows)
  const target = clone.workflows
    .flatMap((workflow) => workflow.inputs)
    .find((input) => input.type === 'textarea')
  delete target.maxLength

  const result = validateWorkflowData(clone, tools)
  assert.ok(result.errors.some((error) => error.includes('必须声明 maxLength')))
})

test('下拉框默认值必须落在选项内', async () => {
  const { workflows, tools } = await loadWorkflowData()
  const clone = structuredClone(workflows)
  const target = clone.workflows
    .flatMap((workflow) => workflow.inputs)
    .find((input) => input.type === 'select')
  target.default = '__not_an_option__'

  const result = validateWorkflowData(clone, tools)
  assert.ok(result.errors.some((error) => error.includes('默认值不在选项内')))
})

test('工作流 slug 重复会被拒绝', async () => {
  const { workflows, tools } = await loadWorkflowData()
  const clone = structuredClone(workflows)
  clone.workflows[1].slug = clone.workflows[0].slug

  const result = validateWorkflowData(clone, tools)
  assert.ok(result.errors.some((error) => error.includes('工作流 slug 重复')))
})

test('没有必填字段的工作流会被拒绝', async () => {
  const { workflows, tools } = await loadWorkflowData()
  const clone = structuredClone(workflows)
  for (const input of clone.workflows[0].inputs) input.required = false

  const result = validateWorkflowData(clone, tools)
  assert.ok(result.errors.some((error) => error.includes('没有任何必填字段')))
})

test('画布操作不进列表，且 surface 取值受限', async () => {
  const { workflows, tools } = await loadWorkflowData()
  const result = validateWorkflowData(workflows, tools)

  assert.equal(result.summary.libraryWorkflows + result.summary.canvasWorkflows, result.summary.workflows)
  assert.ok(result.summary.canvasWorkflows >= 3, '画布至少要有重绘/扩图/变体三个操作')

  const clone = structuredClone(workflows)
  clone.workflows[0].surface = 'sidebar'
  const bad = validateWorkflowData(clone, tools)
  assert.ok(bad.errors.some((error) => error.includes('surface 需为 library 或 canvas')))
})

test('画布操作都以图片入、图片出', async () => {
  const { workflows } = await loadWorkflowData()
  const canvasOps = workflows.workflows.filter((workflow) => workflow.surface === 'canvas')

  for (const op of canvasOps) {
    assert.equal(op.outputKind, 'image', `${op.slug} 的产出必须是图片`)
    const source = op.inputs.find((input) => input.key === 'sourceUrl')
    assert.ok(source, `${op.slug} 必须有 sourceUrl 字段供画布填入`)
    assert.equal(source.type, 'image_url')
    assert.equal(source.required, true)
  }
})
