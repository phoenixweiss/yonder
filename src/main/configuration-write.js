import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { CONFIG_FILENAME, MAX_CONFIG_BYTES, parseConfig } from '../shared/config.js'

const snapshotFields = ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs', 'nlink']

export class GuardedConfigurationError extends Error {
  constructor(code) {
    super(code)
    this.name = 'GuardedConfigurationError'
    this.code = code
  }
}

function fail(code) {
  throw new GuardedConfigurationError(code)
}

function metadata(stat) {
  return Object.fromEntries(snapshotFields.map((field) => [field, String(stat[field])]))
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

export async function captureConfiguration(storagePath) {
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
    if (error instanceof GuardedConfigurationError) throw error
    fail('stateChanged')
  } finally {
    await handle?.close().catch(() => {})
  }
}

export async function replaceConfiguration(candidate, revalidate) {
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
          observedError instanceof GuardedConfigurationError &&
          observedError.code === 'writeFailed'
        ) {
          throw observedError
        }
      }
      fail('writeUncertain')
    }
    if (
      error instanceof GuardedConfigurationError ||
      ['stateChanged', 'writeFailed', 'writeUncertain'].includes(error?.code)
    ) {
      throw error
    }
    fail('writeFailed')
  } finally {
    await temporaryHandle?.close().catch(() => {})
    await fs.unlink(temporaryPath).catch(() => {})
  }
}
