import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { stringify } from 'yaml'
import { openApplyJournal } from '../src/main/apply-journal.js'
import { createConnectionApplyController } from '../src/main/connection-apply.js'
import { NativeLinkError } from '../src/main/native-link-process.js'
import { nativeHelperFixture } from './helpers/native-helper.js'

const mac = { skip: process.platform !== 'darwin' }
let build

before(async () => {
  if (!mac.skip) build = await nativeHelperFixture()
})

after(async () => build?.cleanup())

async function fixture(t, createProcess, { storageInsideHome = false, targetName } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'yonder-apply-test-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const storage = storageInsideHome ? path.join(home, 'storage') : path.join(root, 'storage')
  const configuredTarget = targetName ?? '~/settings/editor'
  const source = path.join(storage, 'sources', 'editor')
  const target = path.join(home, configuredTarget.slice(2))
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(source, 'fixture')
  await fs.writeFile(
    path.join(storage, 'yonder.yaml'),
    stringify({
      version: 1,
      name: 'Apply fixture',
      connections: [
        {
          id: 'editor',
          name: 'Editor',
          source: 'sources/editor',
          targets: { macos: configuredTarget }
        }
      ]
    })
  )
  const journal = await openApplyJournal(path.join(root, 'journal'))
  const controller = createConnectionApplyController({
    executable: build.executable,
    journal,
    createProcess
  })
  t.after(() => controller.clear())
  return { root, storage, home, source, target, journal, controller }
}

test(
  'prepare is read-only and one confirmation creates exactly one checked link',
  mac,
  async (t) => {
    const f = await fixture(t)
    const prepared = await f.controller.prepare(f.storage, 'editor', f.home)
    assert.equal(prepared.status, 'ready')
    await assert.rejects(fs.lstat(f.target), { code: 'ENOENT' })

    assert.deepEqual(await f.controller.confirm(prepared.token), {
      status: 'connected',
      connectionId: 'editor'
    })
    assert.equal(await fs.readlink(f.target), f.source)
    assert.deepEqual(await f.journal.readUnresolved(), { status: 'clear' })
    await assert.rejects(f.controller.confirm(prepared.token), { code: 'selectionExpired' })
  }
)

test('cancel and state changes before confirmation create no link', mac, async (t) => {
  const cancelled = await fixture(t)
  const first = await cancelled.controller.prepare(cancelled.storage, 'editor', cancelled.home)
  assert.deepEqual(await cancelled.controller.cancel(first.token), { status: 'cancelled' })
  await assert.rejects(fs.lstat(cancelled.target), { code: 'ENOENT' })

  const changed = await fixture(t)
  const second = await changed.controller.prepare(changed.storage, 'editor', changed.home)
  await fs.writeFile(changed.source, 'changed')
  await assert.rejects(changed.controller.confirm(second.token), { code: 'stateChanged' })
  await assert.rejects(fs.lstat(changed.target), { code: 'ENOENT' })
  assert.deepEqual(await changed.journal.readUnresolved(), { status: 'clear' })
})

test('a conflict appearing after preparation is preserved', mac, async (t) => {
  const f = await fixture(t)
  const prepared = await f.controller.prepare(f.storage, 'editor', f.home)
  await fs.writeFile(f.target, 'keep me')
  await assert.rejects(f.controller.confirm(prepared.token), { code: 'stateChanged' })
  assert.equal(await fs.readFile(f.target, 'utf8'), 'keep me')
})

test('apply refuses a destination inside its own storage tree', mac, async (t) => {
  const f = await fixture(t, undefined, {
    storageInsideHome: true,
    targetName: '~/storage/settings/editor'
  })
  await assert.rejects(f.controller.prepare(f.storage, 'editor', f.home), { code: 'notReady' })
  await assert.rejects(fs.lstat(f.target), { code: 'ENOENT' })
})

test(
  'an uncertain result is recorded and a later matching-link observation resolves it',
  mac,
  async (t) => {
    let target
    let source
    const createProcess = () => ({
      async prepare() {
        return { token: '00000000-0000-0000-0000-000000000001' }
      },
      async confirm() {
        await fs.symlink(source, target)
        throw new NativeLinkError('creationUncertain')
      },
      async clear() {
        return { status: 'idle' }
      }
    })
    const f = await fixture(t, createProcess)
    target = f.target
    source = f.source
    const prepared = await f.controller.prepare(f.storage, 'editor', f.home)
    await assert.rejects(f.controller.confirm(prepared.token), { code: 'creationUncertain' })
    assert.equal((await f.journal.readUnresolved()).outcome, 'uncertain')

    const next = createConnectionApplyController({
      executable: build.executable,
      journal: f.journal,
      createProcess
    })
    t.after(() => next.clear())
    await assert.rejects(next.prepare(f.storage, 'editor', f.home), {
      code: 'destinationOccupied'
    })
    assert.deepEqual(await f.journal.readUnresolved(), { status: 'clear' })
  }
)
