import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parseDocument } from 'yaml'
import { CONFIG_FILENAME, MAX_CONFIG_BYTES, parseConfig } from '../shared/config.js'
import { ConnectionDraftError } from './connection-draft.js'

const snapshotFields = ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs', 'nlink']

export class ConnectionAuthoringError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ConnectionAuthoringError'
    this.code = code
  }
}

function fail(code) {
  throw new ConnectionAuthoringError(code)
}

function metadata(stat) {
  return Object.fromEntries(snapshotFields.map((field) => [field, String(stat[field])]))
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

async function captureSelection(preview) {
  try {
    const source = await fs.lstat(preview.sourcePath, { bigint: true })
    const targetParent = await fs.lstat(path.dirname(preview.targetPath), { bigint: true })
    if (
      source.isSymbolicLink() ||
      (!source.isFile() && !source.isDirectory()) ||
      targetParent.isSymbolicLink() ||
      !targetParent.isDirectory()
    ) {
      fail('stateChanged')
    }

    let target
    try {
      target = {
        status: 'present',
        ...metadata(await fs.lstat(preview.targetPath, { bigint: true }))
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      target = { status: 'missing' }
    }

    return {
      source: metadata(source),
      targetParent: metadata(targetParent),
      target
    }
  } catch (error) {
    if (error instanceof ConnectionAuthoringError) throw error
    fail('stateChanged')
  }
}

async function captureConfiguration(storagePath) {
  const resolvedStorage = path.resolve(storagePath)
  const configPath = path.join(resolvedStorage, CONFIG_FILENAME)
  let handle

  try {
    const storage = await fs.lstat(resolvedStorage)
    if (!storage.isDirectory() || storage.isSymbolicLink()) fail('stateChanged')

    const initial = await fs.lstat(configPath, { bigint: true })
    if (
      !initial.isFile() ||
      initial.isSymbolicLink() ||
      initial.nlink !== 1n ||
      initial.size > BigInt(MAX_CONFIG_BYTES)
    ) {
      fail('stateChanged')
    }

    handle = await fs.open(
      configPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n || !sameFile(initial, opened)) fail('stateChanged')

    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1)
    let total = 0
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total)
      if (!bytesRead) break
      total += bytesRead
    }

    const after = await handle.stat({ bigint: true })
    const current = await fs.lstat(configPath, { bigint: true })
    if (
      total > MAX_CONFIG_BYTES ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.nlink !== 1n ||
      !sameFile(opened, current) ||
      snapshotFields.some(
        (field) => opened[field] !== after[field] || opened[field] !== current[field]
      )
    ) {
      fail('stateChanged')
    }

    const content = bytes.subarray(0, total)
    const source = new TextDecoder('utf-8', { fatal: true }).decode(content)
    return {
      storagePath: resolvedStorage,
      configPath,
      config: parseConfig(source),
      source,
      mode: Number(opened.mode & 0o777n),
      snapshot: {
        hash: createHash('sha256').update(content).digest('hex'),
        ...metadata(opened)
      }
    }
  } catch (error) {
    if (error instanceof ConnectionAuthoringError) throw error
    fail('stateChanged')
  } finally {
    await handle?.close().catch(() => {})
  }
}

function nextConfigurationSource(originalSource, connection) {
  try {
    const document = parseDocument(originalSource, { uniqueKeys: true, strict: true })
    if (document.errors.length || document.warnings.length) fail('stateChanged')
    const connections = document.get('connections', true)
    if (!connections || typeof connections.add !== 'function') fail('stateChanged')
    connections.flow = false
    connections.add(connection)
    const source = document.toString({ lineWidth: 0 })
    parseConfig(source)
    return source
  } catch (error) {
    if (error instanceof ConnectionAuthoringError) throw error
    fail('stateChanged')
  }
}

async function replaceConfiguration(candidate, revalidate) {
  const temporaryPath = path.join(candidate.storagePath, `.${CONFIG_FILENAME}.${randomUUID()}.tmp`)
  let temporaryHandle
  let renameAttempted = false

  try {
    const before = await captureConfiguration(candidate.storagePath)
    if (!isDeepStrictEqual(before.snapshot, candidate.configurationSnapshot)) fail('stateChanged')

    temporaryHandle = await fs.open(temporaryPath, 'wx', candidate.mode)
    await temporaryHandle.writeFile(candidate.resultingSource, 'utf8')
    await temporaryHandle.sync()
    await temporaryHandle.close()
    temporaryHandle = undefined

    const finalCheck = await captureConfiguration(candidate.storagePath)
    if (!isDeepStrictEqual(finalCheck.snapshot, candidate.configurationSnapshot)) {
      fail('stateChanged')
    }
    await revalidate()

    renameAttempted = true
    await fs.rename(temporaryPath, candidate.configPath)

    const directory = await fs.open(candidate.storagePath, 'r')
    await directory.sync().catch(() => {})
    await directory.close()

    const written = await captureConfiguration(candidate.storagePath)
    if (written.source !== candidate.resultingSource) fail('writeUncertain')
  } catch (error) {
    if (renameAttempted) {
      try {
        const observed = await captureConfiguration(candidate.storagePath)
        if (observed.source === candidate.resultingSource) return
        if (
          observed.source === candidate.originalSource &&
          isDeepStrictEqual(observed.snapshot, candidate.configurationSnapshot)
        ) {
          fail('writeFailed')
        }
      } catch (observedError) {
        if (
          observedError instanceof ConnectionAuthoringError &&
          observedError.code === 'writeFailed'
        ) {
          throw observedError
        }
      }
      fail('writeUncertain')
    }
    if (error instanceof ConnectionAuthoringError) throw error
    fail('writeFailed')
  } finally {
    await temporaryHandle?.close().catch(() => {})
    await fs.unlink(temporaryPath).catch(() => {})
  }
}

export function createConnectionAuthoringController({
  previewDraft,
  replace = replaceConfiguration
}) {
  let pending = null
  let busy = false
  let generation = 0

  async function exclusive(action) {
    if (busy) fail('operationBusy')
    busy = true
    try {
      return await action()
    } catch (error) {
      if (error instanceof ConnectionAuthoringError) throw error
      if (error instanceof ConnectionDraftError) fail(error.code)
      fail('stateChanged')
    } finally {
      busy = false
    }
  }

  async function captureCandidate(storagePath, request) {
    const before = await captureConfiguration(storagePath)
    const preview = await previewDraft(storagePath, request)
    const selection = await captureSelection(preview)
    const after = await captureConfiguration(storagePath)
    if (!isDeepStrictEqual(before.snapshot, after.snapshot)) fail('stateChanged')

    return {
      storagePath: before.storagePath,
      configPath: before.configPath,
      configurationSnapshot: before.snapshot,
      originalSource: before.source,
      resultingSource: nextConfigurationSource(before.source, preview.connection),
      mode: before.mode,
      request: structuredClone(request),
      preview: structuredClone(preview),
      selection
    }
  }

  async function stableCandidate(storagePath, request) {
    const first = await captureCandidate(storagePath, request)
    const second = await captureCandidate(storagePath, request)
    if (!isDeepStrictEqual(first, second)) fail('stateChanged')
    return second
  }

  async function prepare(storagePath, request) {
    return exclusive(async () => {
      pending = null
      const started = ++generation
      const candidate = await stableCandidate(storagePath, request)
      if (started !== generation) fail('selectionExpired')

      const token = randomUUID()
      pending = { token, started, candidate }
      return {
        status: 'ready',
        token,
        configPath: candidate.configPath,
        connection: candidate.preview.connection,
        sourcePath: candidate.preview.sourcePath,
        targetPath: candidate.preview.targetPath,
        yaml: candidate.preview.yaml
      }
    })
  }

  async function confirm(token) {
    return exclusive(async () => {
      if (typeof token !== 'string' || !pending || pending.token !== token) {
        fail('selectionExpired')
      }

      const { candidate, started } = pending
      pending = null
      if (started !== generation) fail('selectionExpired')

      const current = await stableCandidate(candidate.storagePath, candidate.request)
      if (!isDeepStrictEqual(current, candidate)) fail('stateChanged')
      await replace(current, async () => {
        const finalCheck = await stableCandidate(candidate.storagePath, candidate.request)
        if (!isDeepStrictEqual(finalCheck, candidate)) fail('stateChanged')
      })
      generation += 1
      return { status: 'created', connectionId: candidate.preview.connection.id }
    })
  }

  async function cancel(token) {
    return exclusive(async () => {
      if (typeof token !== 'string' || !pending || pending.token !== token) {
        fail('selectionExpired')
      }
      pending = null
      generation += 1
      return { status: 'cancelled' }
    })
  }

  function clear() {
    pending = null
    generation += 1
  }

  return Object.freeze({ prepare, confirm, cancel, clear })
}
