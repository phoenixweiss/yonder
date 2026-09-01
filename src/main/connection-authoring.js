import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parseDocument } from 'yaml'
import { parseConfig } from '../shared/config.js'
import {
  captureConfiguration,
  GuardedConfigurationError,
  replaceConfiguration
} from './configuration-write.js'
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
      if (error instanceof GuardedConfigurationError) fail(error.code)
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
