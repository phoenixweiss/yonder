import { lstat, open, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { CONFIG_FILENAME, ConfigError, MAX_CONFIG_BYTES, parseConfig } from '../shared/config.js'

const READ_CHUNK_BYTES = 64 * 1024

export class StorageInspectionError extends Error {
  constructor(code) {
    super(code)
    this.name = 'StorageInspectionError'
    this.code = code
  }
}

export function platformKey(systemPlatform) {
  return { darwin: 'macos', linux: 'linux', win32: 'windows' }[systemPlatform] ?? null
}

function pathFromPortableRelative(root, relativePath) {
  return join(root, ...relativePath.split('/'))
}

function comparablePath(platform, value) {
  const normalized = value.normalize('NFC')
  return platform === 'linux' ? normalized : normalized.toLowerCase()
}

async function readBoundedUtf8(filePath) {
  let handle
  try {
    handle = await open(filePath, 'r')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new StorageInspectionError('missingConfig')
    throw new StorageInspectionError('unavailable')
  }

  try {
    const chunks = []
    let total = 0

    while (total <= MAX_CONFIG_BYTES) {
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, MAX_CONFIG_BYTES + 1 - total))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      chunks.push(buffer.subarray(0, bytesRead))
      total += bytesRead
    }

    if (total > MAX_CONFIG_BYTES) throw new StorageInspectionError('invalidConfig')
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))
    } catch {
      throw new StorageInspectionError('invalidConfig')
    }
  } catch (error) {
    if (error instanceof StorageInspectionError) throw error
    throw new StorageInspectionError('unavailable')
  } finally {
    await handle.close()
  }
}

async function pathDetails(filePath) {
  try {
    return { status: 'available', details: await lstat(filePath) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'missing' }
    return { status: 'unavailable' }
  }
}

async function inspectConnection(connection, context) {
  const sourcePath = pathFromPortableRelative(context.folderPath, connection.source)
  const target = context.platform ? connection.targets[context.platform] : undefined
  const targetPath = target ? pathFromPortableRelative(context.homeDirectory, target.slice(2)) : ''
  const result = (state) => ({
    id: connection.id,
    name: connection.name,
    sourcePath,
    targetPath,
    state
  })

  if (!target) {
    return result('notConfigured')
  }

  const source = await pathDetails(sourcePath)
  if (source.status === 'missing') {
    return result('sourceMissing')
  }
  if (source.status === 'unavailable') {
    return result('inspectionFailed')
  }

  const destination = await pathDetails(targetPath)
  if (destination.status === 'missing') {
    return result('targetMissing')
  }
  if (destination.status === 'unavailable') {
    return result('inspectionFailed')
  }
  if (!destination.details.isSymbolicLink()) {
    return result('targetOccupied')
  }

  try {
    const [actualSource, actualTarget] = await Promise.all([
      realpath(sourcePath),
      realpath(targetPath)
    ])
    const state =
      comparablePath(context.platform, actualSource) ===
      comparablePath(context.platform, actualTarget)
        ? 'connected'
        : 'targetMismatch'
    return result(state)
  } catch {
    return result('targetMismatch')
  }
}

export async function inspectStorage(directory, { homeDirectory, systemPlatform }) {
  const folderPath = resolve(directory)
  const folder = await pathDetails(folderPath)
  if (folder.status !== 'available' || !folder.details.isDirectory()) {
    throw new StorageInspectionError('unavailable')
  }

  const configPath = join(folderPath, CONFIG_FILENAME)
  const source = await readBoundedUtf8(configPath)
  let config
  try {
    config = parseConfig(source)
  } catch (error) {
    if (error instanceof ConfigError) throw new StorageInspectionError('invalidConfig')
    throw error
  }

  const platform = platformKey(systemPlatform)
  const connections = await Promise.all(
    config.connections.map((connection) =>
      inspectConnection(connection, {
        folderPath,
        homeDirectory: resolve(homeDirectory),
        platform
      })
    )
  )

  return {
    version: config.version,
    name: config.name,
    folderPath,
    configPath,
    platform,
    connections
  }
}
