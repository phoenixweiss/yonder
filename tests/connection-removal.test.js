import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parse, stringify } from 'yaml'
import {
  ConnectionRemovalError,
  createConnectionRemovalController
} from '../src/main/connection-removal.js'

async function fixture(t, options = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'yonder-removal-test-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const storage = path.join(root, 'storage')
  const source = path.join(storage, 'sources', 'removable')
  const retainedSource = path.join(storage, 'sources', 'retained')
  const target = path.join(home, 'settings', 'removable')
  const targetParent = path.dirname(target)
  const configPath = path.join(storage, 'yonder.yaml')
  await Promise.all([
    fs.mkdir(source, { recursive: true }),
    fs.mkdir(retainedSource, { recursive: true }),
    fs.mkdir(targetParent, { recursive: true })
  ])
  const targets = options.targets ?? { macos: '~/settings/removable' }
  const sourceText = [
    '# storage note',
    'version: 1',
    'name: Removal fixture # display note',
    'connections:',
    '  - id: removable',
    '    name: Removable',
    '    source: sources/removable',
    '    targets:',
    ...Object.entries(targets).map(([platform, value]) => `      ${platform}: ${value}`),
    '  # retained note',
    '  - id: retained',
    '    name: Retained',
    '    source: sources/retained',
    '    targets:',
    '      macos: ~/settings/retained',
    ''
  ].join('\n')
  await fs.writeFile(configPath, sourceText)
  await fs.chmod(configPath, 0o640)
  const removal = createConnectionRemovalController(options.controller)
  t.after(() => removal.clear())
  return { home, storage, source, retainedSource, target, targetParent, configPath, removal }
}

test('preparation and cancellation are read-only and invalidate the token', async (t) => {
  const f = await fixture(t)
  const before = await fs.readFile(f.configPath, 'utf8')
  const prepared = await f.removal.prepare(f.storage, 'removable', f.home)

  assert.equal(prepared.status, 'ready')
  assert.equal(prepared.connection.id, 'removable')
  assert.equal(prepared.connection.sourcePath, f.source)
  assert.equal(prepared.connection.targetPath, f.target)
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before)
  assert.deepEqual(await f.removal.cancel(prepared.token), { status: 'cancelled' })
  await assert.rejects(f.removal.confirm(prepared.token), { code: 'selectionExpired' })
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before)
})

test('one confirmation removes only the disconnected definition', async (t) => {
  const f = await fixture(t)
  const mode = (await fs.lstat(f.configPath)).mode & 0o777
  const prepared = await f.removal.prepare(f.storage, 'removable', f.home)

  assert.deepEqual(await f.removal.confirm(prepared.token), {
    status: 'removed',
    connectionId: 'removable'
  })
  const source = await fs.readFile(f.configPath, 'utf8')
  assert.match(source, /# storage note/)
  assert.match(source, /# display note/)
  assert.match(source, /# retained note/)
  assert.deepEqual(parse(source).connections, [
    {
      id: 'retained',
      name: 'Retained',
      source: 'sources/retained',
      targets: { macos: '~/settings/retained' }
    }
  ])
  assert.equal((await fs.lstat(f.configPath)).mode & 0o777, mode)
  assert.equal((await fs.lstat(f.source)).isDirectory(), true)
  assert.equal((await fs.lstat(f.retainedSource)).isDirectory(), true)
  assert.deepEqual(await fs.readdir(f.targetParent), [])
})

test('connected, conflicting, and multi-platform entries are never removed', async (t) => {
  const connected = await fixture(t)
  await fs.symlink(connected.source, connected.target)
  await assert.rejects(connected.removal.prepare(connected.storage, 'removable', connected.home), {
    code: 'notDisconnected'
  })
  assert.equal(await fs.readlink(connected.target), connected.source)

  const occupied = await fixture(t)
  await fs.writeFile(occupied.target, 'keep me')
  await assert.rejects(occupied.removal.prepare(occupied.storage, 'removable', occupied.home), {
    code: 'notDisconnected'
  })
  assert.equal(await fs.readFile(occupied.target, 'utf8'), 'keep me')

  const multiple = await fixture(t, {
    targets: { macos: '~/settings/removable', linux: '~/.config/removable' }
  })
  await assert.rejects(multiple.removal.prepare(multiple.storage, 'removable', multiple.home), {
    code: 'multipleTargets'
  })
})

test('a changed configuration blocks confirmation and preserves the external edit', async (t) => {
  const f = await fixture(t)
  const prepared = await f.removal.prepare(f.storage, 'removable', f.home)
  const external = stringify({ version: 1, name: 'External', connections: [] })
  await fs.writeFile(f.configPath, external)

  await assert.rejects(f.removal.confirm(prepared.token), { code: 'stateChanged' })
  assert.equal(await fs.readFile(f.configPath, 'utf8'), external)
  assert.equal((await fs.lstat(f.source)).isDirectory(), true)
})

test('a destination appearing after preparation blocks the configuration update', async (t) => {
  const f = await fixture(t)
  const before = await fs.readFile(f.configPath, 'utf8')
  const prepared = await f.removal.prepare(f.storage, 'removable', f.home)
  await fs.writeFile(f.target, 'keep me')

  await assert.rejects(f.removal.confirm(prepared.token), { code: 'stateChanged' })
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before)
  assert.equal(await fs.readFile(f.target, 'utf8'), 'keep me')
})

test('a write failure leaves the original configuration and no temporary file', async (t) => {
  const f = await fixture(t, {
    controller: {
      replace: async () => {
        throw new ConnectionRemovalError('writeFailed')
      }
    }
  })
  const before = await fs.readFile(f.configPath, 'utf8')
  const prepared = await f.removal.prepare(f.storage, 'removable', f.home)

  await assert.rejects(f.removal.confirm(prepared.token), { code: 'writeFailed' })
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before)
  assert.deepEqual((await fs.readdir(f.storage)).sort(), ['sources', 'yonder.yaml'])
})
