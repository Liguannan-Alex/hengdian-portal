import assert from 'node:assert/strict'
import test from 'node:test'
import { loadToolData, sanitizeToolUrl, validateToolData } from './validate-tools.mjs'

test('current tool dataset satisfies the v0.2 editorial contract', async () => {
  const { tools, editorial, sceneRules } = await loadToolData()
  const result = validateToolData(tools, editorial, sceneRules)

  assert.deepEqual(result.errors, [])
  assert.equal(result.summary.coreTools, 50)
  assert.equal(result.summary.featuredTools, editorial.featuredToolIds.length)
  assert.ok(result.summary.coveredScenes.includes('productivity'))
  assert.deepEqual(result.summary.linkStatus.emptyEffectiveToolIds, [32, 471])
  assert.deepEqual(result.summary.linkStatus.invalidEffectiveToolIds, [])
  assert.ok(result.summary.linkStatus.trackingParametersRemoved > 0)
  assert.deepEqual(result.summary.linkStatus.remainingTrackingToolIds, [])
  assert.ok(result.summary.linkStatus.duplicateEffectiveUrlGroups.length > 0)
})

test('validator rejects an unverified featured entry', async () => {
  const { tools, editorial, sceneRules } = await loadToolData()
  const clone = structuredClone(editorial)
  const featuredId = clone.featuredToolIds[0]
  clone.entries.find((entry) => entry.id === featuredId).status = 'needs-review'

  const result = validateToolData(tools, clone, sceneRules)
  assert.ok(result.errors.some((error) => error.includes(`精选工具 ${featuredId} 必须完成本轮复核`)))
})

test('validator rejects tracking parameters on a verified canonical URL', async () => {
  const { tools, editorial, sceneRules } = await loadToolData()
  const clone = structuredClone(editorial)
  clone.entries.find((entry) => entry.status === 'verified').url += '?utm_source=test'

  const result = validateToolData(tools, clone, sceneRules)
  assert.ok(result.errors.some((error) => error.includes('URL 仍含跟踪参数')))
})

test('display URL sanitizer removes legacy channel and invitation variants', () => {
  const cleaned = sanitizeToolUrl(
    'https://example.com/path?utm=test&channelid=1&fromId=2&invite_code=3&inviterId=4&huiwaInviteCode=5&sharerUserId=6&source_id=7&keep=ok',
  )
  const url = new URL(cleaned)

  assert.equal(url.searchParams.get('keep'), 'ok')
  assert.deepEqual([...url.searchParams.keys()], ['keep'])
})
