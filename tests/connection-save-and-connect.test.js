import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test, { before, after } from 'node:test'
import { parse, stringify } from 'yaml'
import { createConnectionDraftController } from '../src/main/connection-draft.js'
import { createConnectionAuthoringController } from '../src/main/connection-authoring.js'
import {
  createConnectionApplyController,
  ConnectionApplyError,
  captureStableConnectionObservation
} from '../src/main/connection-apply.js'
import { createSaveAndConnect } from '../src/main/connection-save-and-connect.js'
import { replaceConfiguration, GuardedConfigurationError } from '../src/main/configuration-write.js'
import { openApplyJournal } from '../src/main/apply-journal.js'
import { createOperationGate } from '../src/main/operation-gate.js'
import { inspectStorage } from '../src/main/inspection.js'
import { nativeHelperFixture, createSanitizedNativeLinkProcess } from './helpers/native-helper.js'

let nativeBuild
before(async () => {
  if (process.platform === 'darwin') nativeBuild = await nativeHelperFixture()
})
after(async () => nativeBuild?.cleanup())

async function fixture(t, { sourceType = 'file', realNative = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'yonder-combined-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const storage = path.join(root, 'storage')
  const home = path.join(root, 'home')
  const parent = path.join(home, 'settings')
  await fs.mkdir(storage)
  await fs.mkdir(parent, { recursive: true })
  const source = path.join(storage, 'item')
  if (sourceType === 'folder') await fs.mkdir(source)
  const marker = sourceType === 'file' ? source : path.join(source, 'marker')
  await fs.writeFile(marker, 'test content')
  const configPath = path.join(storage, 'yonder.yaml')
  await fs.writeFile(configPath, stringify({ version: 1, name: 'Fixture', connections: [] }))
  const target = path.join(parent, 'item')
  const hooks = {}
  const f = {
    root,
    storage,
    home,
    parent,
    source,
    marker,
    configPath,
    target,
    hooks,
    starts: 0,
    dispatches: 0
  }
  const draft = createConnectionDraftController({ homeDirectory: home, platform: 'darwin' })
  const selectedSource = await draft.selectSource(storage, source)
  const selectedParent = await draft.selectTargetParent(storage, parent)
  f.request = {
    sourceSelectionId: selectedSource.selectionId,
    targetSelectionId: selectedParent.selectionId,
    name: 'Item',
    id: 'item',
    linkName: 'item'
  }
  f.journal = await openApplyJournal(path.join(root, 'journal'))
  f.apply = createConnectionApplyController({
    platform: 'darwin',
    journal: f.journal,
    executable: nativeBuild?.executable,
    createProcess: realNative
      ? createSanitizedNativeLinkProcess
      : () => ({
          async prepare() {
            f.starts++
            await hooks.nativePrepare?.()
            return { token: 'native-token' }
          },
          async confirm(token) {
            assert.equal(token, 'native-token')
            f.dispatches++
            if (hooks.nativeConfirm) return hooks.nativeConfirm()
            await fs.symlink(source, target)
            return { status: 'created' }
          },
          async clear() {}
        })
  })
  t.after(() => f.apply.clear())
  f.connector = createSaveAndConnect({ applyController: f.apply, homeDirectory: home })
  f.makeAuthoring = (options = {}) =>
    createConnectionAuthoringController({
      previewDraft: (storagePath, request) => draft.preview(storagePath, request),
      connector: f.connector,
      replace: async (candidate, revalidate) => {
        if (hooks.beforeSave) await hooks.beforeSave(candidate, revalidate)
        await replaceConfiguration(candidate, revalidate)
        await hooks.afterSave?.(candidate)
      },
      ...options
    })
  f.authoring = f.makeAuthoring()
  f.review = () => f.authoring.prepare(storage, f.request)
  f.config = async () => parse(await fs.readFile(configPath, 'utf8'))
  return f
}

for (const sourceType of ['file', 'folder']) {
  test(`one confirmation saves and connects ${sourceType}, then restart inspection observes it`, async (t) => {
    const f = await fixture(t, { sourceType })
    const review = await f.review()
    assert.notEqual(review.token, review.connectToken)
    assert.equal(f.starts, 0)
    assert.deepEqual((await f.config()).connections, [])
    const result = await f.authoring.confirm(review.connectToken, 'connect')
    assert.deepEqual(result, { status: 'connected', connectionId: 'item' })
    assert.equal((await f.config()).connections.length, 1)
    assert.equal(await fs.readlink(f.target), f.source)
    assert.equal(await fs.readFile(f.marker, 'utf8'), 'test content')
    assert.equal(f.dispatches, 1)
    const restarted = await inspectStorage(f.storage, {
      homeDirectory: f.home,
      systemPlatform: 'darwin'
    })
    assert.equal(restarted.connections[0].state, 'connected')
    await assert.rejects(f.authoring.confirm(review.connectToken, 'connect'), {
      code: 'selectionExpired'
    })
    await assert.rejects(f.authoring.confirm(review.token), { code: 'selectionExpired' })
  })
  test(
    `real native helper connects a reviewed ${sourceType}`,
    { skip: process.platform !== 'darwin' },
    async (t) => {
      const f = await fixture(t, { sourceType, realNative: true })
      const review = await f.review()
      assert.equal((await f.authoring.confirm(review.connectToken, 'connect')).status, 'connected')
      assert.equal(await fs.readlink(f.target), f.source)
    }
  )
}

test('save only never starts the connector and consumes both tokens', async (t) => {
  const f = await fixture(t)
  f.connector.preflight = () => assert.fail('save only must not check journal')
  const review = await f.review()
  assert.equal((await f.authoring.confirm(review.token)).status, 'created')
  assert.equal(f.starts, 0)
  await assert.rejects(fs.lstat(f.target), { code: 'ENOENT' })
  await assert.rejects(f.authoring.confirm(review.connectToken, 'connect'), {
    code: 'selectionExpired'
  })
})

test('cancel invalidates both modes; a token cannot authorize the other mode', async (t) => {
  const f = await fixture(t)
  const review = await f.review()
  await assert.rejects(f.authoring.confirm(review.token, 'connect'), { code: 'selectionExpired' })
  await assert.rejects(f.authoring.confirm(review.connectToken, 'save'), {
    code: 'selectionExpired'
  })
  await f.authoring.cancel(review.token)
  await assert.rejects(f.authoring.confirm(review.connectToken, 'connect'), {
    code: 'selectionExpired'
  })
  assert.deepEqual((await f.config()).connections, [])
})

test('native failure after saving preserves the definition and source', async (t) => {
  const f = await fixture(t)
  f.hooks.nativePrepare = () => {
    throw new ConnectionApplyError('notReady')
  }
  const review = await f.review()
  assert.deepEqual(await f.authoring.confirm(review.connectToken, 'connect'), {
    status: 'savedNotConnected',
    connectionId: 'item',
    reason: 'notReady',
    uncertain: false
  })
  assert.equal((await f.config()).connections.length, 1)
  assert.equal(await fs.readFile(f.marker, 'utf8'), 'test content')
  await assert.rejects(fs.lstat(f.target), { code: 'ENOENT' })
  assert.equal(f.dispatches, 0)
})

for (const change of ['source', 'parent', 'configuration', 'target']) {
  test(`${change} changed after saving blocks link creation without rolling back YAML`, async (t) => {
    const f = await fixture(t)
    f.hooks.afterSave = async () => {
      if (change === 'source') await fs.writeFile(f.source, 'external content')
      if (change === 'parent') {
        await fs.rename(f.parent, f.parent + '-old')
        await fs.mkdir(f.parent)
      }
      if (change === 'configuration') await fs.appendFile(f.configPath, '# external edit\n')
      if (change === 'target') await fs.writeFile(f.target, 'do not overwrite')
    }
    const review = await f.review()
    const result = await f.authoring.confirm(review.connectToken, 'connect')
    assert.equal(result.status, 'savedNotConnected')
    assert.equal((await f.config()).connections.length, 1)
    assert.equal(f.starts, 0)
    assert.equal(f.dispatches, 0)
    if (change === 'configuration')
      assert.match(await fs.readFile(f.configPath, 'utf8'), /# external edit/)
    if (change === 'target') assert.equal(await fs.readFile(f.target, 'utf8'), 'do not overwrite')
  })
}

test('a native uncertain outcome preserves saved data, journals uncertainty, and never retries', async (t) => {
  const f = await fixture(t)
  f.hooks.nativeConfirm = async () => {
    await fs.symlink(f.source, f.target)
    throw new ConnectionApplyError('creationUncertain')
  }
  const review = await f.review()
  const result = await f.authoring.confirm(review.connectToken, 'connect')
  assert.equal(result.status, 'savedNotConnected')
  assert.equal(result.uncertain, true)
  assert.equal(f.dispatches, 1)
  assert.equal((await f.journal.readUnresolved()).outcome, 'uncertain')
  assert.equal((await f.config()).connections.length, 1)
  await assert.rejects(f.authoring.confirm(review.connectToken, 'connect'), {
    code: 'selectionExpired'
  })
  assert.equal(await fs.readlink(f.target), f.source)
})

for (const code of ['writeFailed', 'writeUncertain']) {
  test(`${code} while saving never dispatches a link`, async (t) => {
    const f = await fixture(t)
    f.hooks.beforeSave = async () => {
      throw new GuardedConfigurationError(code)
    }
    const review = await f.review()
    await assert.rejects(f.authoring.confirm(review.connectToken, 'connect'), { code })
    assert.deepEqual((await f.config()).connections, [])
    assert.equal(f.starts, 0)
  })
}

test('uncertain save after the actual write does not start link creation', async (t) => {
  const f = await fixture(t)
  f.hooks.afterSave = () => {
    throw new GuardedConfigurationError('writeUncertain')
  }
  const review = await f.review()
  await assert.rejects(f.authoring.confirm(review.connectToken, 'connect'), {
    code: 'writeUncertain'
  })
  assert.equal((await f.config()).connections.length, 1)
  assert.equal(f.starts, 0)
})

test('blocked recovery is checked before any configuration write', async (t) => {
  const f = await fixture(t)
  f.connector.preflight = async () => {
    throw new ConnectionApplyError('recoveryRequired')
  }
  const review = await f.review()
  await assert.rejects(f.authoring.confirm(review.connectToken, 'connect'), {
    code: 'recoveryRequired'
  })
  assert.deepEqual((await f.config()).connections, [])
})

test('a real unresolved journal prevents saving a new connection', async (t) => {
  const f = await fixture(t)
  const saved = await f.review()
  await f.authoring.confirm(saved.token)
  const observation = await captureStableConnectionObservation(f.storage, 'item', f.home, 'darwin')
  await f.journal.begin(observation.selection)
  await fs.writeFile(f.configPath, stringify({ version: 1, name: 'Fixture', connections: [] }))
  const review = await f.review()
  await assert.rejects(f.authoring.confirm(review.connectToken, 'connect'), {
    code: 'recoveryRequired'
  })
  assert.deepEqual((await f.config()).connections, [])
  assert.equal(f.starts, 0)
})

test('unavailable journal leaves Save only available, but combined save writes nothing', async (t) => {
  const f = await fixture(t)
  const authoring = f.makeAuthoring({ connector: createSaveAndConnect({ homeDirectory: f.home }) })
  const review = await authoring.prepare(f.storage, f.request)
  await assert.rejects(authoring.confirm(review.connectToken, 'connect'), {
    code: 'journalUnavailable'
  })
  assert.deepEqual((await f.config()).connections, [])
  const next = await authoring.prepare(f.storage, f.request)
  assert.equal((await authoring.confirm(next.token)).status, 'created')
  assert.equal(f.starts, 0)
})

test('source changes during native preparation leave a saved, disconnected definition', async (t) => {
  const f = await fixture(t)
  f.hooks.nativePrepare = () => fs.writeFile(f.source, 'changed after preparation')
  const review = await f.review()
  const result = await f.authoring.confirm(review.connectToken, 'connect')
  assert.equal(result.status, 'savedNotConnected')
  assert.equal(result.reason, 'stateChanged')
  assert.equal(f.dispatches, 0)
  assert.equal((await f.config()).connections.length, 1)
  assert.deepEqual(await f.journal.readUnresolved(), { status: 'clear' })
})

test('an unexpected post-save failure is uncertain, not a claim of no link', async (t) => {
  const f = await fixture(t)
  const authoring = f.makeAuthoring({
    connector: {
      preflight: async () => {},
      connect: async () => {
        throw new Error('interrupted')
      }
    }
  })
  const review = await authoring.prepare(f.storage, f.request)
  const result = await authoring.confirm(review.connectToken, 'connect')
  assert.equal(result.status, 'savedNotConnected')
  assert.equal(result.uncertain, true)
  assert.equal((await f.config()).connections.length, 1)
})

test('double confirmation and competing storage actions are rejected, not queued', async (t) => {
  const f = await fixture(t)
  const started = Promise.withResolvers()
  const finish = Promise.withResolvers()
  f.hooks.nativePrepare = async () => {
    started.resolve()
    await finish.promise
  }
  const review = await f.review()
  const gate = createOperationGate()
  const result = gate(() => f.authoring.confirm(review.connectToken, 'connect'))
  await started.promise
  assert.deepEqual(await gate(() => assert.fail('no concurrent navigation')), {
    status: 'operationBusy'
  })
  await assert.rejects(f.authoring.confirm(review.connectToken, 'connect'), {
    code: 'operationBusy'
  })
  finish.resolve()
  assert.equal((await result).status, 'connected')
  assert.equal(f.dispatches, 1)
  assert.equal(await gate(() => 42), 42)
})

test('a gate failure releases the slot', async () => {
  const gate = createOperationGate()
  await assert.rejects(
    gate(() => {
      throw new Error('fixture')
    })
  )
  assert.equal(await gate(() => 42), 42)
})
