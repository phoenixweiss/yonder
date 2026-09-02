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
    if (['ENOENT', 'ENOTDIR'].includes(error?.code)) return { status: 'missing' }
    return { status: 'unavailable' }
  }
}

async function safePathDetails(root, parts) {
  let currentPath = root
  const entries = [{ path: root, final: parts.length === 0 }]
  for (const [index, part] of parts.entries()) {
    currentPath = join(currentPath, part)
    entries.push({ path: currentPath, final: index === parts.length - 1 })
  }

  for (const entry of entries) {
    const inspected = await pathDetails(entry.path)
    if (inspected.status !== 'available') return inspected
    if (inspected.details.isSymbolicLink()) return { status: 'redirected' }
    if (!entry.final && !inspected.details.isDirectory()) return { status: 'notDirectory' }
    if (entry.final) return inspected
  }

  return { status: 'unavailable' }
}

function blocked(reason) {
  return { status: 'blocked', reason }
}

async function inspectConnection(connection, context) {
  const sourcePath = pathFromPortableRelative(context.folderPath, connection.source)
  const target = context.platform ? connection.targets[context.platform] : undefined
  const targetPath = target ? pathFromPortableRelative(context.homeDirectory, target.slice(2)) : ''
  let sourceType = 'unknown'
  const result = (state, readiness = blocked(state)) => ({
    id: connection.id,
    name: connection.name,
    sourcePath,
    targetPath,
    sourceType,
    state,
    readiness
  })

  if (!target) {
    return result('notConfigured')
  }

  const source = await safePathDetails(context.folderPath, connection.source.split('/'))
  if (source.status === 'missing') {
    return result('sourceMissing')
  }
  if (source.status === 'unavailable') {
    return result('inspectionFailed', blocked('inspectionFailed'))
  }
  if (['redirected', 'notDirectory'].includes(source.status)) {
    return result('inspectionFailed', blocked('sourceUnsafe'))
  }
  if (!source.details.isFile() && !source.details.isDirectory()) {
    return result('inspectionFailed', blocked('sourceUnsupported'))
  }
  sourceType = source.details.isDirectory() ? 'folder' : 'file'

  const destination = await pathDetails(targetPath)
  if (destination.status === 'missing') {
    const targetParts = target.slice(2).split('/')
    const parent = await safePathDetails(context.homeDirectory, targetParts.slice(0, -1))
    if (parent.status === 'missing') {
      return result('targetMissing', blocked('targetParentMissing'))
    }
    if (parent.status === 'unavailable') {
      return result('targetMissing', blocked('inspectionFailed'))
    }
    if (['redirected', 'notDirectory'].includes(parent.status)) {
      return result('targetMissing', blocked('targetParentUnsafe'))
    }
    if (!parent.details.isDirectory()) {
      return result('targetMissing', blocked('targetParentUnsafe'))
    }
    return result('targetMissing', { status: 'ready' })
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
