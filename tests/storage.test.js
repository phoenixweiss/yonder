import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createStorageConfig,
  inspectStorageDirectory,
  StorageCreationError
} from '../src/main/storage.js'
import { inspectStorage } from '../src/main/inspection.js'
import { CONFIG_FILENAME, parseConfig } from '../src/shared/config.js'

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'yonder-storage-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('previews a selected folder without creating files', async (t) => {
  const directory = await temporaryDirectory(t)
  const preview = await inspectStorageDirectory(directory)

  assert.equal(preview.folderPath, directory)
  assert.equal(preview.configPath, join(directory, CONFIG_FILENAME))
  assert.equal(preview.configExists, false)
  assert.deepEqual(await readdir(directory), [])
})

test('creates only a valid empty yonder.yaml after confirmation', async (t) => {
  const directory = await temporaryDirectory(t)
  const result = await createStorageConfig(directory, 'Test storage')
  const entries = await readdir(directory)
  const source = await readFile(result.configPath, 'utf8')

  assert.deepEqual(entries, [CONFIG_FILENAME])
  assert.deepEqual(parseConfig(source), {
    version: 1,
    name: 'Test storage',
    connections: []
  })
  assert.equal(result.source, source)
})

test('a newly created storage can be opened by the read-only inspector', async (t) => {
  const directory = await temporaryDirectory(t)
  const home = await temporaryDirectory(t)
  await createStorageConfig(directory, 'Open after creation')
  const before = await readdir(directory)

  const storage = await inspectStorage(directory, {
    homeDirectory: home,
    systemPlatform: 'darwin'
  })

  assert.equal(storage.name, 'Open after creation')
  assert.deepEqual(storage.connections, [])
  assert.deepEqual(await readdir(directory), before)
})

test('never replaces an existing yonder.yaml', async (t) => {
  const directory = await temporaryDirectory(t)
  const configPath = join(directory, CONFIG_FILENAME)
  const original = 'private fixture that must stay unchanged\n'
  await writeFile(configPath, original)

  await assert.rejects(
    () => createStorageConfig(directory, 'Test storage'),
    (error) => error instanceof StorageCreationError && error.code === 'configExists'
  )
  assert.equal(await readFile(configPath, 'utf8'), original)
})

test('rejects an invalid name before writing anything', async (t) => {
  const directory = await temporaryDirectory(t)

  await assert.rejects(
    () => createStorageConfig(directory, ' Test storage '),
    (error) => error instanceof StorageCreationError && error.code === 'invalidName'
  )
  assert.deepEqual(await readdir(directory), [])
})

test('rejects unavailable and non-directory paths', async (t) => {
  const directory = await temporaryDirectory(t)
  const filePath = join(directory, 'ordinary-file')
  await writeFile(filePath, 'fixture')

  for (const path of [filePath, join(directory, 'missing')]) {
    await assert.rejects(
      () => inspectStorageDirectory(path),
      (error) => error instanceof StorageCreationError && error.code === 'invalidDirectory'
    )
  }
})
