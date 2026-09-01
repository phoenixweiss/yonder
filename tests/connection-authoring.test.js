import assert from 'node:assert/strict'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parse, stringify } from 'yaml'
import {
  ConnectionAuthoringError,
  createConnectionAuthoringController
} from '../src/main/connection-authoring.js'
import { createConnectionDraftController } from '../src/main/connection-draft.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yonder-connection-authoring-'))
  const storage = join(root, 'storage')
  const home = join(root, 'home')
  const source = join(storage, 'Sources', 'Documents')
  const sourceMarker = join(source, 'marker.txt')
  const targetParent = join(home, 'Library', 'Application Support', 'Example')
  const targetPath = join(targetParent, 'Documents')
  const configPath = join(storage, 'yonder.yaml')
  await Promise.all([mkdir(source, { recursive: true }), mkdir(targetParent, { recursive: true })])
  await writeFile(sourceMarker, 'source marker\n')
  await writeFile(
    configPath,
    stringify({ version: 1, name: 'Authoring fixture', connections: [] }, { lineWidth: 0 })
  )
  await chmod(configPath, 0o640)
  t.after(() => rm(root, { recursive: true, force: true }))

  const draft = createConnectionDraftController({ homeDirectory: home, platform: 'darwin' })
  const selectedSource = await draft.selectSource(storage, source)
  const selectedTarget = await draft.selectTargetParent(storage, targetParent)
  const request = {
    sourceSelectionId: selectedSource.selectionId,
    targetSelectionId: selectedTarget.selectionId,
    name: 'Documents',
    id: 'documents',
    linkName: 'Documents'
  }
  const createAuthoring = (options = {}) =>
    createConnectionAuthoringController({
      previewDraft: (storagePath, value) => draft.preview(storagePath, value),
      ...options
    })

  return {
    root,
    storage,
    home,
    source,
    sourceMarker,
    targetParent,
    targetPath,
    configPath,
    request,
    createAuthoring
  }
}

test('preparation and cancellation are read-only and invalidate the token', async (t) => {
  const f = await fixture(t)
  const authoring = f.createAuthoring()
  const before = {
    config: await readFile(f.configPath, 'utf8'),
    storage: await readdir(f.storage),
    targetParent: await readdir(f.targetParent)
  }

  const prepared = await authoring.prepare(f.storage, f.request)
  assert.equal(prepared.status, 'ready')
  assert.equal(typeof prepared.token, 'string')
  assert.equal(prepared.connection.id, 'documents')
  assert.equal(prepared.sourcePath, f.source)
  assert.equal(prepared.targetPath, f.targetPath)
  assert.deepEqual(
    {
      config: await readFile(f.configPath, 'utf8'),
      storage: await readdir(f.storage),
      targetParent: await readdir(f.targetParent)
    },
    before
  )

  assert.deepEqual(await authoring.cancel(prepared.token), { status: 'cancelled' })
  await assert.rejects(
    () => authoring.confirm(prepared.token),
    (error) => error instanceof ConnectionAuthoringError && error.code === 'selectionExpired'
  )
})

test('one confirmation updates only yonder.yaml and creates no link', async (t) => {
  const f = await fixture(t)
  const authoring = f.createAuthoring()
  const marker = await readFile(f.sourceMarker, 'utf8')
  const mode = (await lstat(f.configPath)).mode & 0o777
  const prepared = await authoring.prepare(f.storage, f.request)

  assert.deepEqual(await authoring.confirm(prepared.token), {
    status: 'created',
    connectionId: 'documents'
  })
  const source = await readFile(f.configPath, 'utf8')
  assert.match(source, /connections:\n {2}- id: documents\n {4}name: Documents/)
  const config = parse(source)
  assert.deepEqual(config, {
    version: 1,
    name: 'Authoring fixture',
    connections: [
      {
        id: 'documents',
        name: 'Documents',
        source: 'Sources/Documents',
        targets: { macos: '~/Library/Application Support/Example/Documents' }
      }
    ]
  })
  assert.equal((await lstat(f.configPath)).mode & 0o777, mode)
  assert.equal(await readFile(f.sourceMarker, 'utf8'), marker)
  assert.deepEqual(await readdir(f.targetParent), [])
  assert.deepEqual((await readdir(f.storage)).sort(), ['Sources', 'yonder.yaml'])
  await assert.rejects(
    () => authoring.confirm(prepared.token),
    (error) => error.code === 'selectionExpired'
  )
})

test('the confirmed update preserves existing YAML comments', async (t) => {
  const f = await fixture(t)
  const commented = [
    '# storage note',
    'version: 1',
    'name: Authoring fixture # display note',
    'connections: [] # connection note',
    ''
  ].join('\n')
  await writeFile(f.configPath, commented)
  const authoring = f.createAuthoring()
  const prepared = await authoring.prepare(f.storage, f.request)
  await authoring.confirm(prepared.token)

  const source = await readFile(f.configPath, 'utf8')
  assert.match(source, /# storage note/)
  assert.match(source, /# display note/)
  assert.match(source, /# connection note/)
  assert.equal(parse(source).connections[0].id, 'documents')
})

test('a changed configuration blocks confirmation without replacing the external edit', async (t) => {
  const f = await fixture(t)
  const authoring = f.createAuthoring()
  const prepared = await authoring.prepare(f.storage, f.request)
  const external = stringify(
    {
      version: 1,
      name: 'Externally edited fixture',
      connections: []
    },
    { lineWidth: 0 }
  )
  await writeFile(f.configPath, external)

  await assert.rejects(
    () => authoring.confirm(prepared.token),
    (error) => error instanceof ConnectionAuthoringError && error.code === 'stateChanged'
  )
  assert.equal(await readFile(f.configPath, 'utf8'), external)
  assert.deepEqual(await readdir(f.targetParent), [])
})

test('a redirected source blocks confirmation and preserves the configuration', async (t) => {
  const f = await fixture(t)
  const authoring = f.createAuthoring()
  const prepared = await authoring.prepare(f.storage, f.request)
  const before = await readFile(f.configPath, 'utf8')
  const replacement = join(f.root, 'replacement')
  await mkdir(replacement)
  await rm(f.source, { recursive: true })
  await symlink(replacement, f.source)

  await assert.rejects(
    () => authoring.confirm(prepared.token),
    (error) => error instanceof ConnectionAuthoringError && error.code === 'sourceUnsafe'
  )
  assert.equal(await readFile(f.configPath, 'utf8'), before)
  assert.deepEqual(await readdir(f.targetParent), [])
})

test('a replaced source blocks confirmation and preserves the configuration', async (t) => {
  const f = await fixture(t)
  const authoring = f.createAuthoring()
  const prepared = await authoring.prepare(f.storage, f.request)
  const before = await readFile(f.configPath, 'utf8')
  await rm(f.source, { recursive: true })
  await mkdir(f.source)

  await assert.rejects(
    () => authoring.confirm(prepared.token),
    (error) => error instanceof ConnectionAuthoringError && error.code === 'stateChanged'
  )
  assert.equal(await readFile(f.configPath, 'utf8'), before)
  assert.deepEqual(await readdir(f.targetParent), [])
})

test('a hard-linked configuration is rejected before preparation', async (t) => {
  const f = await fixture(t)
  const authoring = f.createAuthoring()
  const linkedConfig = join(f.root, 'linked-yonder.yaml')
  await link(f.configPath, linkedConfig)
  const before = await readFile(f.configPath, 'utf8')

  await assert.rejects(
    () => authoring.prepare(f.storage, f.request),
    (error) => error instanceof ConnectionAuthoringError && error.code === 'stateChanged'
  )
  assert.equal(await readFile(f.configPath, 'utf8'), before)
})

test('a destination appearing after preparation blocks the configuration write', async (t) => {
  const f = await fixture(t)
  const authoring = f.createAuthoring()
  const prepared = await authoring.prepare(f.storage, f.request)
  const before = await readFile(f.configPath, 'utf8')
  await mkdir(f.targetPath)

  await assert.rejects(
    () => authoring.confirm(prepared.token),
    (error) => error instanceof ConnectionAuthoringError && error.code === 'stateChanged'
  )
  assert.equal(await readFile(f.configPath, 'utf8'), before)
  assert.deepEqual(await readdir(f.targetParent), ['Documents'])
})

test('a write failure leaves the original configuration and no temporary file', async (t) => {
  const f = await fixture(t)
  const before = await readFile(f.configPath, 'utf8')
  const authoring = f.createAuthoring({
    replace: async () => {
      throw new ConnectionAuthoringError('writeFailed')
    }
  })
  const prepared = await authoring.prepare(f.storage, f.request)

  await assert.rejects(
    () => authoring.confirm(prepared.token),
    (error) => error instanceof ConnectionAuthoringError && error.code === 'writeFailed'
  )
  assert.equal(await readFile(f.configPath, 'utf8'), before)
  assert.deepEqual((await readdir(f.storage)).sort(), ['Sources', 'yonder.yaml'])
  assert.deepEqual(await readdir(f.targetParent), [])
})
