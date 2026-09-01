import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stringify } from 'yaml'
import { inspectStorage, platformKey, StorageInspectionError } from '../src/main/inspection.js'
import { MAX_CONFIG_BYTES } from '../src/shared/config.js'

async function temporaryFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yonder-inspection-test-'))
  const storage = join(root, 'storage')
  const home = join(root, 'home')
  await Promise.all([mkdir(storage), mkdir(home)])
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, storage, home }
}

async function writeConfig(storage, connections) {
  await writeFile(
    join(storage, 'yonder.yaml'),
    stringify({ version: 1, name: 'Inspection fixture', connections })
  )
}

function connection(id, targets = { macos: '~/.config/example' }) {
  return {
    id,
    name: id,
    source: `sources/${id}`,
    targets
  }
}

test('maps supported operating systems to configuration platform keys', () => {
  assert.equal(platformKey('darwin'), 'macos')
  assert.equal(platformKey('linux'), 'linux')
  assert.equal(platformKey('win32'), 'windows')
  assert.equal(platformKey('freebsd'), null)
})

test('inspects every connection state without changing files', async (t) => {
  const { storage, home } = await temporaryFixture(t)
  const connections = [
    connection('connected', { macos: '~/.config/connected' }),
    connection('target-missing', { macos: '~/.config/target-missing' }),
    connection('target-occupied', { macos: '~/.config/target-occupied' }),
    connection('target-mismatch', { macos: '~/.config/target-mismatch' }),
    connection('source-missing', { macos: '~/.config/source-missing' }),
    connection('not-configured', { linux: '~/.config/not-configured' })
  ]
  await writeConfig(storage, connections)

  for (const id of ['connected', 'target-missing', 'target-occupied', 'target-mismatch']) {
    await mkdir(join(storage, 'sources', id), { recursive: true })
  }
  await mkdir(join(storage, 'sources', 'not-configured'), { recursive: true })
  await mkdir(join(home, '.config'), { recursive: true })
  await symlink(join(storage, 'sources', 'connected'), join(home, '.config', 'connected'))
  await writeFile(join(home, '.config', 'target-occupied'), 'existing fixture')
  await symlink(join(storage, 'sources', 'connected'), join(home, '.config', 'target-mismatch'))

  const before = await readdir(join(home, '.config'))
  const result = await inspectStorage(storage, {
    homeDirectory: home,
    systemPlatform: 'darwin'
  })
  const after = await readdir(join(home, '.config'))

  assert.equal(result.name, 'Inspection fixture')
  assert.equal(result.platform, 'macos')
  assert.deepEqual(Object.fromEntries(result.connections.map(({ id, state }) => [id, state])), {
    connected: 'connected',
    'target-missing': 'targetMissing',
    'target-occupied': 'targetOccupied',
    'target-mismatch': 'targetMismatch',
    'source-missing': 'sourceMissing',
    'not-configured': 'notConfigured'
  })
  assert.deepEqual(Object.keys(result.connections[0]).sort(), [
    'id',
    'name',
    'readiness',
    'sourcePath',
    'state',
    'targetPath'
  ])
  assert.deepEqual(result.connections.find(({ id }) => id === 'target-missing').readiness, {
    status: 'ready'
  })
  assert.deepEqual(after, before)
})

test('preview readiness blocks missing or redirected parents and redirected sources', async (t) => {
  const { storage, home } = await temporaryFixture(t)
  const connections = [
    connection('ready', { macos: '~/.config/ready' }),
    connection('missing-parent', { macos: '~/missing/nested' }),
    connection('redirected-parent', { macos: '~/redirected/nested' }),
    connection('occupied-parent', { macos: '~/ordinary-file/nested' }),
    connection('redirected-source', { macos: '~/.config/redirected-source' })
  ]
  await writeConfig(storage, connections)
  await mkdir(join(storage, 'sources'), { recursive: true })
  for (const id of ['ready', 'missing-parent', 'redirected-parent', 'occupied-parent']) {
    await mkdir(join(storage, 'sources', id))
  }
  await symlink(join(storage, 'sources', 'ready'), join(storage, 'sources', 'redirected-source'))
  await mkdir(join(home, '.config'))
  await symlink(join(home, '.config'), join(home, 'redirected'))
  await writeFile(join(home, 'ordinary-file'), 'fixture')

  const before = {
    home: await readdir(home),
    config: await readdir(join(home, '.config')),
    sources: await readdir(join(storage, 'sources'))
  }
  const result = await inspectStorage(storage, {
    homeDirectory: home,
    systemPlatform: 'darwin'
  })

  assert.deepEqual(
    Object.fromEntries(result.connections.map(({ id, readiness }) => [id, readiness])),
    {
      ready: { status: 'ready' },
      'missing-parent': { status: 'blocked', reason: 'targetParentMissing' },
      'redirected-parent': { status: 'blocked', reason: 'targetParentUnsafe' },
      'occupied-parent': { status: 'blocked', reason: 'targetParentUnsafe' },
      'redirected-source': { status: 'blocked', reason: 'sourceUnsafe' }
    }
  )
  assert.equal(
    result.connections.find(({ id }) => id === 'redirected-source').state,
    'inspectionFailed'
  )
  assert.deepEqual(
    {
      home: await readdir(home),
      config: await readdir(join(home, '.config')),
      sources: await readdir(join(storage, 'sources'))
    },
    before
  )
})

test('classifies missing, malformed, oversized and non-UTF-8 configurations', async (t) => {
  const { storage, home } = await temporaryFixture(t)
  const configPath = join(storage, 'yonder.yaml')

  for (const [source, code] of [
    [null, 'missingConfig'],
    ['version: 1\nname: broken\nconnections: [', 'invalidConfig'],
    [Buffer.alloc(MAX_CONFIG_BYTES + 1, 120), 'invalidConfig'],
    [Buffer.from([0xff, 0xfe]), 'invalidConfig']
  ]) {
    if (source !== null) await writeFile(configPath, source)
    await assert.rejects(
      () => inspectStorage(storage, { homeDirectory: home, systemPlatform: 'darwin' }),
      (error) => error instanceof StorageInspectionError && error.code === code
    )
  }
})

test('returns an unavailable error for a non-directory storage path', async (t) => {
  const { root, home } = await temporaryFixture(t)
  const filePath = join(root, 'ordinary-file')
  await writeFile(filePath, 'fixture')

  await assert.rejects(
    () => inspectStorage(filePath, { homeDirectory: home, systemPlatform: 'darwin' }),
    (error) => error instanceof StorageInspectionError && error.code === 'unavailable'
  )
})
