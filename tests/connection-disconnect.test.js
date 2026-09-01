import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { stringify } from 'yaml'
import { createConnectionDisconnectController } from '../src/main/connection-disconnect.js'
import { NativeLinkError } from '../src/main/native-link-process.js'
import { nativeHelperFixture } from './helpers/native-helper.js'

const mac = { skip: process.platform !== 'darwin' }
let build

before(async () => {
  if (!mac.skip) build = await nativeHelperFixture()
})

after(async () => build?.cleanup())

async function fixture(t, createProcess) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'yonder-disconnect-test-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const storage = path.join(root, 'storage')
  const source = path.join(storage, 'sources', 'editor')
  const target = path.join(home, 'settings', 'editor')
  const configPath = path.join(storage, 'yonder.yaml')
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(source, 'fixture')
  await fs.writeFile(
    configPath,
    stringify({
      version: 1,
      name: 'Disconnect fixture',
      connections: [
        {
          id: 'editor',
          name: 'Editor',
          source: 'sources/editor',
          targets: { macos: '~/settings/editor' }
        }
      ]
    })
  )
  await fs.symlink(source, target)
  const controller = createConnectionDisconnectController({
    executable: build.executable,
    createProcess
  })
  t.after(() => controller.clear())
  return { root, storage, home, source, target, configPath, controller }
}

test(
  'prepare and cancellation are read-only, then one confirmation removes only the link',
  mac,
  async (t) => {
    const f = await fixture(t)
    const before = {
      config: await fs.readFile(f.configPath, 'utf8'),
      source: await fs.readFile(f.source, 'utf8')
    }
    const first = await f.controller.prepare(f.storage, 'editor', f.home)
    assert.equal(first.status, 'ready')
    assert.equal(await fs.readlink(f.target), f.source)
    assert.deepEqual(await f.controller.cancel(first.token), { status: 'cancelled' })
    assert.equal(await fs.readlink(f.target), f.source)
    await assert.rejects(f.controller.confirm(first.token), { code: 'selectionExpired' })

    const second = await f.controller.prepare(f.storage, 'editor', f.home)
    assert.deepEqual(await f.controller.confirm(second.token), {
      status: 'disconnected',
      connectionId: 'editor'
    })
    await assert.rejects(fs.lstat(f.target), { code: 'ENOENT' })
    assert.deepEqual(
      {
        config: await fs.readFile(f.configPath, 'utf8'),
        source: await fs.readFile(f.source, 'utf8')
      },
      before
    )
  }
)

test('a changed configuration blocks removal and preserves the link', mac, async (t) => {
  const f = await fixture(t)
  const prepared = await f.controller.prepare(f.storage, 'editor', f.home)
  await fs.appendFile(f.configPath, '# external change\n')

  await assert.rejects(f.controller.confirm(prepared.token), { code: 'stateChanged' })
  assert.equal(await fs.readlink(f.target), f.source)
})

test('a replaced link is never removed', mac, async (t) => {
  const f = await fixture(t)
  const prepared = await f.controller.prepare(f.storage, 'editor', f.home)
  const other = path.join(f.root, 'other')
  await fs.writeFile(other, 'other')
  await fs.unlink(f.target)
  await fs.symlink(other, f.target)

  await assert.rejects(f.controller.confirm(prepared.token), { code: 'stateChanged' })
  assert.equal(await fs.readlink(f.target), other)
})

test('a non-link destination is rejected and preserved', mac, async (t) => {
  const f = await fixture(t)
  await fs.unlink(f.target)
  await fs.writeFile(f.target, 'keep me')

  await assert.rejects(f.controller.prepare(f.storage, 'editor', f.home), {
    code: 'notConnected'
  })
  assert.equal(await fs.readFile(f.target, 'utf8'), 'keep me')
})

test(
  'an uncertain native result resolves only after the exact link is observed absent',
  mac,
  async (t) => {
    let target
    let preparedAction
    const createProcess = () => ({
      async prepare(request) {
        preparedAction = request.action
        return { token: '00000000-0000-0000-0000-000000000001' }
      },
      async confirm() {
        await fs.unlink(target)
        throw new NativeLinkError('removalUncertain')
      },
      async clear() {
        return { status: 'idle' }
      }
    })
    const f = await fixture(t, createProcess)
    target = f.target
    const prepared = await f.controller.prepare(f.storage, 'editor', f.home)
    assert.equal(preparedAction, 'remove')
    assert.deepEqual(await f.controller.confirm(prepared.token), {
      status: 'disconnected',
      connectionId: 'editor'
    })
    await assert.rejects(fs.lstat(f.target), { code: 'ENOENT' })
  }
)
