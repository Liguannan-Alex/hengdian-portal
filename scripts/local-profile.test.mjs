import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url))
const AUTH_SOURCE = path.join(PROJECT_ROOT, 'src/lib/auth.tsx')
const STORAGE_SOURCE = path.join(PROJECT_ROOT, 'src/lib/storage.ts')
const TEST_TEMP_ROOT = tmpdir().startsWith('/tmp') || tmpdir().startsWith('/private/tmp') ? tmpdir() : '/tmp'

const probeSource = `
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AuthProvider, useAuth } from ${JSON.stringify(AUTH_SOURCE)}
import {
  FAVORITES_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  readStorage,
} from ${JSON.stringify(STORAGE_SOURCE)}

let capturedAuth = null

function CaptureAuth() {
  capturedAuth = useAuth()
  return null
}

export function createHarness(localStorage) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
    writable: true,
  })

  capturedAuth = null
  renderToStaticMarkup(
    createElement(AuthProvider, null, createElement(CaptureAuth)),
  )

  if (!capturedAuth) throw new Error('未能捕获 AuthProvider 上下文')

  return {
    initial: {
      profile: capturedAuth.profile,
      favorites: [...capturedAuth.favorites],
      storageAvailable: capturedAuth.storageAvailable,
      storageNotice: capturedAuth.storageNotice,
    },
    toggleFavorite: (id) => capturedAuth.toggleFavorite(id),
    saveProfile: (name) => capturedAuth.saveProfile(name),
    readProfile: () => readStorage(PROFILE_STORAGE_KEY),
    readFavorites: () => readStorage(FAVORITES_STORAGE_KEY),
  }
}
`

function createLocalStorage(initialEntries = {}) {
  const entries = new Map(Object.entries(initialEntries))

  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null
    },
    setItem(key, value) {
      entries.set(key, String(value))
    },
    removeItem(key) {
      entries.delete(key)
    },
    value(key) {
      return entries.get(key)
    },
  }
}

function createThrowingStorage() {
  const fail = () => {
    throw new Error('localStorage blocked')
  }

  return {
    getItem: fail,
    setItem: fail,
    removeItem: fail,
  }
}

async function buildIsolatedHarness() {
  const directory = await mkdtemp(path.join(TEST_TEMP_ROOT, 'hd-local-profile-test-'))
  const entryPoint = path.join(directory, 'probe.tsx')
  const outputFile = path.join(directory, 'probe.cjs')

  try {
    await writeFile(entryPoint, probeSource, 'utf8')
    await build({
      absWorkingDir: PROJECT_ROOT,
      alias: { '@': path.join(PROJECT_ROOT, 'src') },
      bundle: true,
      entryPoints: [entryPoint],
      format: 'cjs',
      jsx: 'automatic',
      logLevel: 'silent',
      nodePaths: [path.join(PROJECT_ROOT, 'node_modules')],
      outfile: outputFile,
      platform: 'node',
      target: 'node20',
    })

    const moduleUrl = `${pathToFileURL(outputFile).href}?instance=${encodeURIComponent(path.basename(directory))}`
    const imported = await import(moduleUrl)
    const probe = imported.default ?? imported

    return {
      createHarness: probe.createHarness,
      async cleanup() {
        delete globalThis.window
        await rm(directory, { force: true, recursive: true })
      },
    }
  } catch (error) {
    await rm(directory, { force: true, recursive: true })
    throw error
  }
}

test('首次运行复制迁移旧档案与旧收藏，并保留旧键', { concurrency: false }, async () => {
  const isolated = await buildIsolatedHarness()
  const storage = createLocalStorage({
    hd_session: '横店创作组',
    'hd_favs_横店创作组': JSON.stringify([3, 8, 8]),
  })

  try {
    const auth = isolated.createHarness(storage)

    assert.deepEqual(auth.initial.profile, { name: '横店创作组' })
    assert.deepEqual(auth.initial.favorites, [3, 8])
    assert.equal(storage.value('hd_profile_v1'), JSON.stringify({ name: '横店创作组' }))
    assert.equal(storage.value('hd_favorites_v1'), JSON.stringify([3, 8]))
    assert.equal(storage.value('hd_session'), '横店创作组')
    assert.equal(storage.value('hd_favs_横店创作组'), JSON.stringify([3, 8, 8]))
  } finally {
    await isolated.cleanup()
  }
})

test('未建档收藏会在保存档案后自动写入收藏', { concurrency: false }, async () => {
  const isolated = await buildIsolatedHarness()
  const storage = createLocalStorage()

  try {
    const auth = isolated.createHarness(storage)

    assert.equal(auth.toggleFavorite(42), false)
    const result = auth.saveProfile('剧组用户')

    assert.equal(result.ok, true)
    assert.match(result.message ?? '', /自动加入本机工具箱/)
    assert.deepEqual(JSON.parse(storage.value('hd_profile_v1')), { name: '剧组用户' })
    assert.deepEqual(JSON.parse(storage.value('hd_favorites_v1')), [42])
  } finally {
    await isolated.cleanup()
  }
})

test('localStorage 抛错时使用当前页面内存路径继续保存和收藏', { concurrency: false }, async () => {
  const isolated = await buildIsolatedHarness()

  try {
    const auth = isolated.createHarness(createThrowingStorage())

    assert.equal(auth.initial.storageAvailable, false)
    assert.match(auth.initial.storageNotice ?? '', /当前页面.*不会长期保留/)
    assert.equal(auth.toggleFavorite(31), false)

    const saveResult = auth.saveProfile('临时用户')
    assert.equal(saveResult.ok, true)
    assert.match(saveResult.message ?? '', /自动加入本机工具箱/)
    assert.equal(auth.toggleFavorite(32), true)

    const profileRead = auth.readProfile()
    const favoritesRead = auth.readFavorites()
    assert.equal(profileRead.available, false)
    assert.equal(favoritesRead.available, false)
    assert.deepEqual(JSON.parse(profileRead.value), { name: '临时用户' })
    assert.deepEqual(JSON.parse(favoritesRead.value), [31, 32])
    assert.match(favoritesRead.notice ?? '', /当前页面.*不会长期保留/)
  } finally {
    await isolated.cleanup()
  }
})
