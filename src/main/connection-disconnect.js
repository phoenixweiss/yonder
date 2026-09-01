import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { captureStableConnectionObservation, ConnectionApplyError } from './connection-apply.js'
import { createNativeLinkProcess, NativeLinkError } from './native-link-process.js'

const linkFields = ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs', 'nlink']

export class ConnectionDisconnectError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ConnectionDisconnectError'
    this.code = code
  }
}

function fail(code) {
  throw new ConnectionDisconnectError(code)
}

function metadata(stat) {
  return Object.fromEntries(linkFields.map((field) => [field, String(stat[field])]))
}

async function captureManagedLink(observation) {
  if (observation.connection.state !== 'connected') fail('notConnected')
  try {
    const target = await fs.lstat(observation.selection.targetPath, { bigint: true })
    if (!target.isSymbolicLink() || target.nlink !== 1n) fail('linkMismatch')
    const destination = await fs.readlink(observation.selection.targetPath)
    if (destination !== observation.selection.sourcePath) fail('linkMismatch')
    return { destination, ...metadata(target) }
  } catch (error) {
    if (error instanceof ConnectionDisconnectError) throw error
    fail(error?.code === 'ENOENT' ? 'notConnected' : 'linkMismatch')
  }
}

async function captureCandidate(storagePath, connectionId, homeDirectory, platform) {
  const observation = await captureStableConnectionObservation(
    storagePath,
    connectionId,
    homeDirectory,
    platform
  )
  const link = await captureManagedLink(observation)
  return { observation, link }
}

async function stableCandidate(...args) {
  const first = await captureCandidate(...args)
  const second = await captureCandidate(...args)
  if (!isDeepStrictEqual(first, second)) fail('stateChanged')
  return second
}

export function createConnectionDisconnectController({
  executable,
  platform = process.platform,
  createProcess = createNativeLinkProcess
} = {}) {
  const native = createProcess({ executable, platform })
  let pending = null
  let busy = false
  let generation = 0

  async function exclusive(action) {
    if (busy) fail('operationBusy')
    busy = true
    try {
      return await action()
    } catch (error) {
      if (error instanceof ConnectionDisconnectError) throw error
      if (error instanceof ConnectionApplyError || error instanceof NativeLinkError) {
        fail(error.code)
      }
      fail('notReady')
    } finally {
      busy = false
    }
  }

  async function observeRemoval(candidate) {
    const selection = candidate.observation.selection
    const current = await captureStableConnectionObservation(
      selection.storagePath,
      selection.connectionId,
      selection.homePath,
      platform
    )
    if (
      !isDeepStrictEqual(current.selection, selection) ||
      current.connection.state !== 'targetMissing'
    ) {
      fail('removalUncertain')
    }
    return { status: 'disconnected', connectionId: selection.connectionId }
  }

  async function prepare(storagePath, connectionId, homeDirectory) {
    return exclusive(async () => {
      pending = null
      const started = ++generation
      await native.clear()
      const candidate = await stableCandidate(storagePath, connectionId, homeDirectory, platform)
      const selection = candidate.observation.selection
      const parentPath = path.dirname(selection.targetPath)
      const parent = selection.directories.find(({ path: value }) => value === parentPath)
      if (!parent) fail('stateChanged')
      const prepared = await native.prepare({
        action: 'remove',
        parent: parent.path,
        device: parent.dev,
        inode: parent.ino,
        source: selection.sourcePath,
        name: path.basename(selection.targetPath)
      })
      const current = await stableCandidate(
        selection.storagePath,
        selection.connectionId,
        selection.homePath,
        platform
      )
      if (started !== generation || !isDeepStrictEqual(candidate, current)) {
        await native.clear()
        fail('stateChanged')
      }
      pending = { token: prepared.token, candidate: structuredClone(candidate), started }
      return {
        status: 'ready',
        token: prepared.token,
        connection: {
          id: selection.connectionId,
          name: candidate.observation.connection.name,
          sourcePath: selection.sourcePath,
          targetPath: selection.targetPath
        },
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
      let dispatched = false
      try {
        if (started !== generation) fail('selectionExpired')
        const selection = candidate.observation.selection
        let current
        try {
          current = await stableCandidate(
            selection.storagePath,
            selection.connectionId,
            selection.homePath,
            platform
          )
        } catch (error) {
          if (['notConnected', 'linkMismatch'].includes(error?.code)) fail('stateChanged')
          throw error
        }
        if (!isDeepStrictEqual(candidate, current)) fail('stateChanged')

        dispatched = true
        const result = await native.confirm(token)
        if (result.status !== 'removed') fail('removalUncertain')
        const disconnected = await observeRemoval(candidate)
        generation += 1
        return disconnected
      } catch (error) {
        await native.clear().catch(() => {})
        if (dispatched && error?.code === 'removalUncertain') {
          try {
            const disconnected = await observeRemoval(candidate)
            generation += 1
            return disconnected
          } catch {
            fail('removalUncertain')
          }
        }
        throw error
      }
    })
  }

  async function cancel(token) {
    return exclusive(async () => {
      if (typeof token !== 'string' || !pending || pending.token !== token) {
        fail('selectionExpired')
      }
      pending = null
      generation += 1
      await native.clear()
      return { status: 'cancelled' }
    })
  }

  async function clear() {
    pending = null
    generation += 1
    await native.clear().catch(() => {})
  }

  return Object.freeze({ prepare, confirm, cancel, clear })
}
