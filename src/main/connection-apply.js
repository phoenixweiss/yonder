import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { CONFIG_FILENAME, MAX_CONFIG_BYTES, parseConfig } from '../shared/config.js'
import { inspectStorage } from './inspection.js'
import { ApplyJournalError } from './apply-journal.js'
import { createNativeLinkProcess, NativeLinkError } from './native-link-process.js'

const sourceFields = ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs', 'nlink']
const configFields = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']

export class ConnectionApplyError extends Error {
  constructor(code, recovery = null) {
    super(code)
    this.name = 'ConnectionApplyError'
    this.code = code
    this.recovery = recovery
  }
}

function fail(code, recovery) {
  throw new ConnectionApplyError(code, recovery)
}

function metadata(stat, fields) {
  return Object.fromEntries(fields.map((field) => [field, String(stat[field])]))
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function within(root, filename) {
  const relative = path.relative(root, filename)
  return (
    relative &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
}

async function captureConfiguration(storagePath) {
  const filename = path.join(storagePath, CONFIG_FILENAME)
  let initial
  let handle
  try {
    initial = await fs.lstat(filename, { bigint: true })
    if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1n) fail('stateChanged')
    if (initial.size > BigInt(MAX_CONFIG_BYTES)) fail('stateChanged')
    handle = await fs.open(
      filename,
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
    const current = await fs.lstat(filename, { bigint: true })
    if (
      total > MAX_CONFIG_BYTES ||
      !current.isFile() ||
      current.nlink !== 1n ||
      !sameFile(opened, current) ||
      [...configFields, 'mode', 'nlink'].some(
        (field) => opened[field] !== after[field] || opened[field] !== current[field]
      )
    ) {
      fail('stateChanged')
    }
    const content = bytes.subarray(0, total)
    const source = new TextDecoder('utf-8', { fatal: true }).decode(content)
    return {
      config: parseConfig(source),
      snapshot: {
        hash: createHash('sha256').update(content).digest('hex'),
        ...metadata(opened, configFields)
      }
    }
  } catch (error) {
    if (error instanceof ConnectionApplyError) throw error
    fail('stateChanged')
  } finally {
    await handle?.close().catch(() => {})
  }
}

function ancestorPaths(filename) {
  const paths = []
  for (let current = filename; ; current = path.dirname(current)) {
    paths.push(current)
    if (current === path.parse(current).root) break
  }
  return paths.reverse()
}

async function captureDirectories(paths) {
  const directories = new Map()
  for (const filename of paths) {
    for (const directory of ancestorPaths(filename)) {
      if (directories.has(directory)) continue
      const stat = await fs.lstat(directory, { bigint: true })
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('stateChanged')
      directories.set(directory, { path: directory, ...metadata(stat, ['dev', 'ino']) })
    }
  }
  return [...directories.values()].sort((left, right) => left.path.localeCompare(right.path))
}

async function captureObservation(storagePath, connectionId, homeDirectory, platform) {
  if (platform !== 'darwin') fail('unsupportedPlatform')
  if (typeof connectionId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(connectionId)) {
    fail('notReady')
  }
  const resolvedStorage = path.resolve(storagePath)
  const resolvedHome = path.resolve(homeDirectory)
  const configurationBefore = await captureConfiguration(resolvedStorage)
  const storage = await inspectStorage(resolvedStorage, {
    homeDirectory: resolvedHome,
    systemPlatform: platform
  })
  const configurationAfter = await captureConfiguration(resolvedStorage)
  if (!isDeepStrictEqual(configurationBefore, configurationAfter)) fail('stateChanged')

  const configured = configurationBefore.config.connections.find(({ id }) => id === connectionId)
  const connection = storage.connections.find(({ id }) => id === connectionId)
  if (!configured || !connection || !configured.targets.macos || !connection.targetPath) {
    fail('notReady')
  }
  const sourcePath = path.resolve(connection.sourcePath)
  const targetPath = path.resolve(connection.targetPath)
  if (
    !within(resolvedStorage, sourcePath) ||
    !within(resolvedHome, targetPath) ||
    sourcePath !== path.join(resolvedStorage, configured.source) ||
    targetPath !== path.join(resolvedHome, configured.targets.macos.slice(2))
  ) {
    fail('stateChanged')
  }
  if (
    targetPath === resolvedStorage ||
    within(resolvedStorage, targetPath) ||
    within(targetPath, resolvedStorage)
  ) {
    fail('notReady')
  }

  const directories = await captureDirectories([
    resolvedStorage,
    resolvedHome,
    path.dirname(sourcePath),
    path.dirname(targetPath)
  ])
  const source = await fs.lstat(sourcePath, { bigint: true })
  if ((!source.isFile() && !source.isDirectory()) || source.isSymbolicLink()) fail('stateChanged')

  return {
    connection,
    selection: {
      storagePath: resolvedStorage,
      homePath: resolvedHome,
      connectionId,
      sourcePath,
      targetPath,
      configuration: configurationBefore.snapshot,
      source: metadata(source, sourceFields),
      directories
    }
  }
}

export async function captureStableConnectionObservation(...args) {
  const first = await captureObservation(...args)
  const second = await captureObservation(...args)
  if (!isDeepStrictEqual(first, second)) fail('stateChanged')
  return second
}

function requireReady(observation) {
  const { connection } = observation
  if (connection.state === 'targetMissing' && connection.readiness?.status === 'ready') return
  if (['targetOccupied', 'targetMismatch', 'connected'].includes(connection.state)) {
    fail('destinationOccupied')
  }
  if (connection.state === 'sourceMissing') fail('sourceMissing')
  if (connection.readiness?.reason === 'targetParentMissing') fail('parentsMissing')
  fail('notReady')
}

async function destinationMissing(filename) {
  try {
    await fs.lstat(filename)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    fail('stateChanged')
  }
  fail('destinationOccupied')
}

function publicRecovery(operation, outcome, observation) {
  const selection = operation.selection
  return {
    operationId: operation.id,
    sourcePath: selection.sourcePath,
    targetPath: selection.targetPath,
    outcome,
    observation
  }
}

export function createConnectionApplyController({
  executable,
  journal,
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
      if (error instanceof ConnectionApplyError) throw error
      if (error instanceof NativeLinkError || error instanceof ApplyJournalError) {
        fail(error.code)
      }
      fail('notReady')
    } finally {
      busy = false
    }
  }

  async function recoverUnresolved() {
    const unresolved = await journal.readUnresolved()
    if (unresolved.status === 'clear') return
    const { operation, outcome } = unresolved
    let observed
    try {
      observed = await captureStableConnectionObservation(
        operation.selection.storagePath,
        operation.selection.connectionId,
        operation.selection.homePath,
        platform
      )
    } catch {
      fail('recoveryRequired', publicRecovery(operation, outcome, 'stateChanged'))
    }
    if (!isDeepStrictEqual(observed.selection, operation.selection)) {
      fail('recoveryRequired', publicRecovery(operation, outcome, 'stateChanged'))
    }
    if (observed.connection.state === 'connected') {
      const target = await fs.readlink(operation.selection.targetPath)
      if (target === operation.selection.sourcePath) {
        await journal.resolveConnected(operation.id)
        return
      }
    }
    const observation = observed.connection.state === 'targetMissing' ? 'absent' : 'conflict'
    fail('recoveryRequired', publicRecovery(operation, outcome, observation))
  }

  async function prepare(storagePath, connectionId, homeDirectory) {
    return exclusive(async () => {
      pending = null
      const started = ++generation
      await native.clear()
      await recoverUnresolved()
      const candidate = await captureStableConnectionObservation(
        storagePath,
        connectionId,
        homeDirectory,
        platform
      )
      requireReady(candidate)
      await destinationMissing(candidate.selection.targetPath)
      const parentPath = path.dirname(candidate.selection.targetPath)
      const parent = candidate.selection.directories.find(({ path: value }) => value === parentPath)
      if (!parent) fail('stateChanged')
      const prepared = await native.prepare({
        action: 'create',
        parent: parent.path,
        device: parent.dev,
        inode: parent.ino,
        source: candidate.selection.sourcePath,
        name: path.basename(candidate.selection.targetPath)
      })
      const current = await captureStableConnectionObservation(
        storagePath,
        connectionId,
        homeDirectory,
        platform
      )
      if (started !== generation || !isDeepStrictEqual(candidate, current)) {
        await native.clear()
        fail('stateChanged')
      }
      requireReady(current)
      await destinationMissing(current.selection.targetPath)
      pending = { token: prepared.token, candidate: structuredClone(candidate), started }
      return {
        status: 'ready',
        token: prepared.token,
        connection: {
          id: connectionId,
          name: candidate.connection.name,
          sourcePath: candidate.selection.sourcePath,
          targetPath: candidate.selection.targetPath
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
      let operation = null
      let dispatched = false
      let outcomeAttempted = false

      async function recordOutcome(outcome) {
        outcomeAttempted = true
        await journal.recordOutcome(operation.id, outcome)
      }

      try {
        if (started !== generation) fail('selectionExpired')
        const current = await captureStableConnectionObservation(
          candidate.selection.storagePath,
          candidate.selection.connectionId,
          candidate.selection.homePath,
          platform
        )
        if (!isDeepStrictEqual(candidate, current)) fail('stateChanged')
        requireReady(current)
        await destinationMissing(current.selection.targetPath)

        const begun = await journal.begin(structuredClone(candidate.selection))
        operation = begun.operation
        const finalCheck = await captureStableConnectionObservation(
          candidate.selection.storagePath,
          candidate.selection.connectionId,
          candidate.selection.homePath,
          platform
        )
        if (started !== generation || !isDeepStrictEqual(candidate, finalCheck)) {
          fail('stateChanged')
        }
        requireReady(finalCheck)
        await destinationMissing(finalCheck.selection.targetPath)

        dispatched = true
        const result = await native.confirm(token)
        if (result.status !== 'created') fail('creationUncertain')
        const connected = await captureStableConnectionObservation(
          candidate.selection.storagePath,
          candidate.selection.connectionId,
          candidate.selection.homePath,
          platform
        )
        if (
          !isDeepStrictEqual(candidate.selection, connected.selection) ||
          connected.connection.state !== 'connected' ||
          (await fs.readlink(candidate.selection.targetPath)) !== candidate.selection.sourcePath
        ) {
          fail('creationUncertain')
        }
        await recordOutcome('connected')
        return { status: 'connected', connectionId: candidate.selection.connectionId }
      } catch (error) {
        await native.clear().catch(() => {})
        if (operation && !outcomeAttempted) {
          let outcome = dispatched ? 'uncertain' : 'notApplied'
          if (error?.code === 'destinationOccupied') outcome = 'notApplied'
          try {
            await recordOutcome(outcome)
          } catch {
            if (dispatched) fail('creationUncertain')
            fail('journalWriteUncertain')
          }
        }
        if (dispatched && !['destinationOccupied', 'stateChanged'].includes(error?.code)) {
          fail('creationUncertain')
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
      generation++
      await native.clear()
      return { status: 'cancelled' }
    })
  }

  async function clear() {
    pending = null
    generation++
    await native.clear().catch(() => {})
  }

  return Object.freeze({ prepare, confirm, cancel, clear })
}
