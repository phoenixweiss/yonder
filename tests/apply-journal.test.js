import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { openApplyJournal } from '../src/main/apply-journal.js'

const mac = { skip: process.platform !== 'darwin' }

function selection(id = 'editor') {
  return {
    storagePath: '/private/tmp/storage',
    homePath: '/Users/fixture',
    connectionId: id,
    sourcePath: `/private/tmp/storage/sources/${id}`,
    targetPath: `/Users/fixture/settings/${id}`,
    configuration: {
      hash: 'a'.repeat(64),
      dev: '1',
      ino: '2',
      size: '3',
      mtimeNs: '4',
      ctimeNs: '5'
    },
    source: {
      dev: '1',
      ino: '6',
      mode: '33188',
      size: '7',
      mtimeNs: '8',
      ctimeNs: '9',
      nlink: '1'
    },
    directories: [
      { path: '/', dev: '1', ino: '1' },
      { path: '/private', dev: '1', ino: '10' },
      { path: '/private/tmp', dev: '1', ino: '11' }
    ]
  }
}

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'yonder-journal-test-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'journal')
  return { directory, journal: await openApplyJournal(directory) }
}

test('journal accepts canonical case spelling but rejects a journal symlink', mac, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'yonder-journal-case-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const canonicalParent = path.join(root, 'Yonder')
  const requestedParent = path.join(root, 'yonder')
  const canonicalJournal = path.join(canonicalParent, 'journal')
  const requestedJournal = path.join(requestedParent, 'journal')
  await fs.mkdir(canonicalParent)

  const journal = await openApplyJournal(requestedJournal)
  assert.deepEqual(await journal.readUnresolved(), { status: 'clear' })
  assert.equal(await fs.realpath(requestedJournal), canonicalJournal)

  const journalLink = path.join(root, 'journal-link')
  await fs.symlink(canonicalJournal, journalLink)
  await assert.rejects(openApplyJournal(journalLink), { code: 'journalUnavailable' })
})

test(
  'journal blocks unresolved work and resolves recorded outcomes append-only',
  mac,
  async (t) => {
    const f = await fixture(t)
    assert.deepEqual(await f.journal.readUnresolved(), { status: 'clear' })

    const first = await f.journal.begin(selection())
    assert.equal((await f.journal.readUnresolved()).outcome, 'unknown')
    await assert.rejects(f.journal.begin(selection('other')), { code: 'recoveryRequired' })
    await f.journal.recordOutcome(first.operation.id, 'connected')
    assert.deepEqual(await f.journal.readUnresolved(), { status: 'clear' })

    const second = await f.journal.begin(selection('other'))
    await f.journal.recordOutcome(second.operation.id, 'uncertain')
    assert.equal((await f.journal.readUnresolved()).outcome, 'uncertain')
    await f.journal.resolveConnected(second.operation.id)
    assert.deepEqual(await f.journal.readUnresolved(), { status: 'clear' })

    const names = await fs.readdir(f.directory)
    assert.deepEqual(
      names.sort(),
      [
        `${first.operation.id}.intent.json`,
        `${first.operation.id}.result.json`,
        `${second.operation.id}.intent.json`,
        `${second.operation.id}.resolution.json`,
        `${second.operation.id}.result.json`
      ].sort()
    )
  }
)

test('journal rejects unexpected or modified records instead of granting apply', mac, async (t) => {
  const f = await fixture(t)
  await f.journal.begin(selection())
  await fs.writeFile(path.join(f.directory, 'unexpected.txt'), 'keep')
  await assert.rejects(f.journal.readUnresolved(), { code: 'journalInvalid' })
})
