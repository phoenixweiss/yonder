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
import { ConnectionApplyError } from './connection-apply.js'

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
  replace = replaceConfiguration,
  connector
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
      const connectToken = connector ? randomUUID() : null
      pending = { token, connectToken, started, candidate }
      return {
        status: 'ready',
        token,
        connectToken,
        configPath: candidate.configPath,
        connection: candidate.preview.connection,
        sourcePath: candidate.preview.sourcePath,
        targetPath: candidate.preview.targetPath,
        sourceType: candidate.preview.sourceType,
        yaml: candidate.preview.yaml
      }
    })
  }

  async function confirm(token, mode = 'save') {
    return exclusive(async () => {
      if (
        !['save', 'connect'].includes(mode) ||
        typeof token !== 'string' ||
        !pending ||
        (mode === 'connect' ? pending.connectToken : pending.token) !== token
      ) {
        fail('selectionExpired')
      }

      const { candidate, started } = pending
      pending = null
      if (started !== generation) fail('selectionExpired')

      const current = await stableCandidate(candidate.storagePath, candidate.request)
      if (!isDeepStrictEqual(current, candidate)) fail('stateChanged')
      if (mode === 'connect') {
        if (!connector || current.selection.target.status !== 'missing') fail('stateChanged')
        try {
          await connector.preflight()
        } catch (error) {
          // No configuration write has been attempted yet.
          fail(error instanceof ConnectionApplyError ? error.code : 'unavailable')
        }
      }
      await replace(current, async () => {
        if (started !== generation) fail('selectionExpired')
        const finalCheck = await stableCandidate(candidate.storagePath, candidate.request)
        if (!isDeepStrictEqual(finalCheck, candidate)) fail('stateChanged')
      })
      generation += 1
      if (mode === 'connect') {
        try {
          if (started + 1 !== generation) fail('selectionExpired')
          const connected = await connector.connect(candidate)
          if (connected.status !== 'connected') throw new ConnectionApplyError('creationUncertain')
          return { status: 'connected', connectionId: candidate.preview.connection.id }
        } catch (error) {
          const known =
            error instanceof ConnectionApplyError || error instanceof ConnectionAuthoringError
          return {
            status: 'savedNotConnected',
            connectionId: candidate.preview.connection.id,
            reason: known ? error.code : 'creationUncertain',
            uncertain:
              !known ||
              ['creationUncertain', 'journalWriteUncertain', 'recoveryRequired'].includes(
                error.code
              )
          }
        }
      }
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
