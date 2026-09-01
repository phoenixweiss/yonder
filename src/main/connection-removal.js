import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parseDocument } from 'yaml'
import { parseConfig } from '../shared/config.js'
import { captureStableConnectionObservation, ConnectionApplyError } from './connection-apply.js'
import {
  captureConfiguration,
  GuardedConfigurationError,
  replaceConfiguration
} from './configuration-write.js'

export class ConnectionRemovalError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ConnectionRemovalError'
    this.code = code
  }
}

function fail(code) {
  throw new ConnectionRemovalError(code)
}

function sourceWithoutConnection(originalSource, connectionId) {
  try {
    const document = parseDocument(originalSource, { uniqueKeys: true, strict: true })
    if (document.errors.length || document.warnings.length) fail('stateChanged')
    const connections = document.get('connections', true)
    if (
      !connections ||
      !Array.isArray(connections.items) ||
      typeof connections.delete !== 'function'
    ) {
      fail('stateChanged')
    }
    const matches = connections.items
      .map((connection, index) => ({ id: connection?.get?.('id'), index }))
      .filter(({ id }) => id === connectionId)
    if (matches.length !== 1) fail('stateChanged')
    connections.flow = false
    connections.delete(matches[0].index)
    const source = document.toString({ lineWidth: 0 })
    const config = parseConfig(source)
    if (config.connections.some(({ id }) => id === connectionId)) fail('stateChanged')
    return source
  } catch (error) {
    if (error instanceof ConnectionRemovalError) throw error
    fail('stateChanged')
  }
}

export function createConnectionRemovalController({
  platform = process.platform,
  replace = replaceConfiguration
} = {}) {
  let pending = null
  let busy = false
  let generation = 0

  async function exclusive(action) {
    if (busy) fail('operationBusy')
    busy = true
    try {
      return await action()
    } catch (error) {
      if (error instanceof ConnectionRemovalError) throw error
      if (error instanceof ConnectionApplyError || error instanceof GuardedConfigurationError) {
        fail(error.code)
      }
      fail('stateChanged')
    } finally {
      busy = false
    }
  }

  async function captureCandidate(storagePath, connectionId, homeDirectory) {
    const before = await captureConfiguration(storagePath)
    const observation = await captureStableConnectionObservation(
      storagePath,
      connectionId,
      homeDirectory,
      platform
    )
    const after = await captureConfiguration(storagePath)
    if (!isDeepStrictEqual(before.snapshot, after.snapshot)) fail('stateChanged')

    const configured = before.config.connections.find(({ id }) => id === connectionId)
    if (!configured) fail('invalidSelection')
    if (Object.keys(configured.targets).length !== 1 || !configured.targets.macos) {
      fail('multipleTargets')
    }
    if (
      observation.connection.state !== 'targetMissing' ||
      observation.connection.readiness?.status !== 'ready'
    ) {
      fail('notDisconnected')
    }

    const selection = observation.selection
    const targetParentPath = path.dirname(selection.targetPath)
    const targetParent = selection.directories.find(({ path: value }) => value === targetParentPath)
    if (!targetParent) fail('stateChanged')

    return {
      storagePath: before.storagePath,
      configPath: before.configPath,
      configurationSnapshot: before.snapshot,
      originalSource: before.source,
      resultingSource: sourceWithoutConnection(before.source, connectionId),
      mode: before.mode,
      connectionId,
      homeDirectory: selection.homePath,
      connection: {
        id: connectionId,
        name: observation.connection.name,
        sourcePath: selection.sourcePath,
        targetPath: selection.targetPath
      },
      guardedSelection: {
        source: selection.source,
        targetParent,
        sourcePath: selection.sourcePath,
        targetPath: selection.targetPath
      }
    }
  }

  async function stableCandidate(...args) {
    const first = await captureCandidate(...args)
    const second = await captureCandidate(...args)
    if (!isDeepStrictEqual(first, second)) fail('stateChanged')
    return second
  }

  async function requireSameCandidate(candidate) {
    let current
    try {
      current = await stableCandidate(
        candidate.storagePath,
        candidate.connectionId,
        candidate.homeDirectory
      )
    } catch {
      fail('stateChanged')
    }
    if (!isDeepStrictEqual(current, candidate)) fail('stateChanged')
    return current
  }

  async function prepare(storagePath, connectionId, homeDirectory) {
    return exclusive(async () => {
      pending = null
      const started = ++generation
      const candidate = await stableCandidate(storagePath, connectionId, homeDirectory)
      if (started !== generation) fail('selectionExpired')

      const token = randomUUID()
      pending = { token, started, candidate }
      return {
        status: 'ready',
        token,
        configPath: candidate.configPath,
        connection: candidate.connection,
        checkedAt: new Date().toISOString()
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

      const current = await requireSameCandidate(candidate)
      await replace(current, async () => {
        await requireSameCandidate(candidate)
      })
      generation += 1
      return { status: 'removed', connectionId: candidate.connectionId }
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
