import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stringify } from 'yaml'
import {
  ConnectionDraftError,
  createConnectionDraftController
} from '../src/main/connection-draft.js'
import {
  isValidConnectionId,
  isValidLinkName,
  suggestConnectionId
} from '../src/shared/connection-draft.js'

async function fixture(t, connections = []) {
  const root = await mkdtemp(join(tmpdir(), 'yonder-connection-draft-'))
  const storage = join(root, 'storage')
  const home = join(root, 'home')
  const source = join(storage, 'Sources', 'Documents')
  const targetParent = join(home, 'Library', 'Application Support', 'Example')
  await Promise.all([mkdir(source, { recursive: true }), mkdir(targetParent, { recursive: true })])
  const configPath = join(storage, 'yonder.yaml')
  await writeFile(
    configPath,
    stringify({ version: 1, name: 'Draft fixture', connections }, { lineWidth: 0 })
  )
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, storage, home, source, targetParent, configPath }
}

function controller(home) {
  return createConnectionDraftController({ homeDirectory: home, platform: 'darwin' })
}

test('suggests stable editable identifiers and validates single path components', () => {
  assert.equal(suggestConnectionId('Document Templates'), 'document-templates')
  assert.equal(suggestConnectionId('Документы'), 'connection-1')
  assert.equal(
    suggestConnectionId('Document Templates', ['document-templates']),
    'document-templates-1'
  )
  assert.equal(isValidConnectionId('documents-2'), true)
  assert.equal(isValidConnectionId('Documents'), false)
  assert.equal(isValidLinkName('Application Support'), true)
  assert.equal(isValidLinkName('../outside'), false)
  assert.equal(isValidLinkName('nested/path'), false)
})

test('previews one exact connection entry without changing any file', async (t) => {
  const f = await fixture(t)
  const draft = controller(f.home)
  const before = {
    config: await readFile(f.configPath, 'utf8'),
    storage: await readdir(f.storage),
    targetParent: await readdir(f.targetParent)
  }
  const source = await draft.selectSource(f.storage, f.source)
  const target = await draft.selectTargetParent(f.storage, f.targetParent)
  const result = await draft.preview(f.storage, {
    sourceSelectionId: source.selectionId,
    targetSelectionId: target.selectionId,
    name: 'Documents',
    id: 'documents',
    linkName: 'Documents'
  })

  assert.equal(result.status, 'ready')
  assert.equal(result.configPath, f.configPath)
  assert.equal(result.sourcePath, f.source)
  assert.equal(result.targetPath, join(f.targetParent, 'Documents'))
  assert.deepEqual(result.connection, {
    id: 'documents',
    name: 'Documents',
    source: 'Sources/Documents',
    targets: { macos: '~/Library/Application Support/Example/Documents' }
  })
  assert.equal(
    result.yaml,
    [
      '- id: documents',
      '  name: Documents',
      '  source: Sources/Documents',
      '  targets:',
      '    macos: ~/Library/Application Support/Example/Documents'
    ].join('\n')
  )
  assert.deepEqual(
    {
      config: await readFile(f.configPath, 'utf8'),
      storage: await readdir(f.storage),
      targetParent: await readdir(f.targetParent)
    },
    before
  )
})

test('rejects selections outside the storage or home and symbolic-link redirects', async (t) => {
  const f = await fixture(t)
  const draft = controller(f.home)
  const outside = join(f.root, 'outside')
  const redirectedSource = join(f.storage, 'redirected-source')
  const redirectedTarget = join(f.home, 'redirected-target')
  await mkdir(outside)
  await symlink(f.source, redirectedSource)
  await symlink(f.targetParent, redirectedTarget)

  for (const [action, code] of [
    [() => draft.selectSource(f.storage, outside), 'sourceOutsideStorage'],
    [() => draft.selectSource(f.storage, redirectedSource), 'sourceUnsafe'],
    [() => draft.selectTargetParent(f.storage, outside), 'targetOutsideHome'],
    [() => draft.selectTargetParent(f.storage, redirectedTarget), 'targetParentUnsafe']
  ]) {
    await assert.rejects(
      action,
      (error) => error instanceof ConnectionDraftError && error.code === code
    )
  }
})

test('rejects duplicate identifiers, overlapping targets, and expired tokens', async (t) => {
  const existing = {
    id: 'existing',
    name: 'Existing',
    source: 'Sources/Existing',
    targets: { macos: '~/Library/Application Support/Example/Existing' }
  }
  const f = await fixture(t, [existing])
  const draft = controller(f.home)
  const source = await draft.selectSource(f.storage, f.source)
  const target = await draft.selectTargetParent(f.storage, f.targetParent)
  const request = {
    sourceSelectionId: source.selectionId,
    targetSelectionId: target.selectionId,
    name: 'Documents',
    id: 'documents',
    linkName: 'Documents'
  }

  await assert.rejects(
    () => draft.preview(f.storage, { ...request, id: 'existing' }),
    (error) => error.code === 'duplicateId'
  )
  await assert.rejects(
    () => draft.preview(f.storage, { ...request, linkName: 'Existing' }),
    (error) => error.code === 'targetOverlap'
  )
  draft.clear()
  await assert.rejects(
    () => draft.preview(f.storage, request),
    (error) => error.code === 'invalidSelection'
  )
})
