import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { stringify } from 'yaml'
import {
  CONFIG_FILENAME,
  isValidStorageName,
  MAX_CONNECTIONS,
  parseConfig
} from '../shared/config.js'
import { isValidConnectionId, isValidLinkName } from '../shared/connection-draft.js'
import { inspectStorage } from './inspection.js'

export class ConnectionDraftError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ConnectionDraftError'
    this.code = code
  }
}

function fail(code) {
  throw new ConnectionDraftError(code)
}

function inside(root, filename, allowRoot = false) {
  const relative = path.relative(root, filename)
  return (
    (allowRoot || relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function portable(relative) {
  return relative.split(path.sep).join('/')
}

async function inspectDirectPath(root, filename, { allowRoot = false, final = 'directory' } = {}) {
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(filename)
  if (!inside(resolvedRoot, resolvedPath, allowRoot))
    fail(final === 'source' ? 'sourceOutsideStorage' : 'targetOutsideHome')

  const relative = path.relative(resolvedRoot, resolvedPath)
  const parts = relative ? relative.split(path.sep) : []
  let current = resolvedRoot
  const entries = [{ path: current, last: parts.length === 0 }]
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part)
    entries.push({ path: current, last: index === parts.length - 1 })
  }

  try {
    for (const entry of entries) {
      const details = await fs.lstat(entry.path)
      if (details.isSymbolicLink()) fail(final === 'source' ? 'sourceUnsafe' : 'targetParentUnsafe')
      if (!entry.last && !details.isDirectory()) {
        fail(final === 'source' ? 'sourceUnsafe' : 'targetParentUnsafe')
      }
      if (entry.last) {
        if (final === 'source' && !details.isFile() && !details.isDirectory())
          fail('sourceUnsupported')
        if (final === 'directory' && !details.isDirectory()) fail('targetParentUnsafe')
      }
    }
  } catch (error) {
    if (error instanceof ConnectionDraftError) throw error
    fail(final === 'source' ? 'sourceUnsafe' : 'targetParentUnsafe')
  }

  return { root: resolvedRoot, path: resolvedPath, relative: portable(relative) }
}

function comparable(value) {
  return value.normalize('NFC').toLowerCase()
}

function overlaps(left, right) {
  const first = comparable(left)
  const second = comparable(right)
  return (
    first === second ||
    first.startsWith(`${second}${path.sep}`) ||
    second.startsWith(`${first}${path.sep}`)
  )
}

export function createConnectionDraftController({
  homeDirectory,
  platform = process.platform,
  inspect = inspectStorage
} = {}) {
  const homePath = path.resolve(homeDirectory)
  let sourceSelection = null
  let targetSelection = null

  function clear() {
    sourceSelection = null
    targetSelection = null
  }

  async function selectSource(storagePath, selectedPath) {
    const source = await inspectDirectPath(storagePath, selectedPath, { final: 'source' })
    if (!source.relative || source.relative.toLowerCase() === CONFIG_FILENAME) fail('sourceUnsafe')
    sourceSelection = {
      id: randomUUID(),
      storagePath: source.root,
      relative: source.relative
    }
    return {
      status: 'ready',
      selectionId: sourceSelection.id,
      relativePath: source.relative,
      displayPath: source.path,
      defaultLinkName: path.basename(source.path)
    }
  }

  async function selectTargetParent(storagePath, selectedPath) {
    if (platform !== 'darwin') fail('unsupportedPlatform')
    const parent = await inspectDirectPath(homePath, selectedPath, { allowRoot: true })
    targetSelection = {
      id: randomUUID(),
      storagePath: path.resolve(storagePath),
      relative: parent.relative
    }
    return {
      status: 'ready',
      selectionId: targetSelection.id,
      relativePath: parent.relative ? `~/${parent.relative}` : '~',
      displayPath: parent.path
    }
  }

  async function preview(storagePath, request) {
    if (platform !== 'darwin') fail('unsupportedPlatform')
    if (
      !request ||
      Object.keys(request).length !== 5 ||
      typeof request.sourceSelectionId !== 'string' ||
      typeof request.targetSelectionId !== 'string' ||
      typeof request.name !== 'string' ||
      typeof request.id !== 'string' ||
      typeof request.linkName !== 'string'
    ) {
      fail('invalidSelection')
    }

    const resolvedStorage = path.resolve(storagePath)
    if (
      sourceSelection?.id !== request.sourceSelectionId ||
      targetSelection?.id !== request.targetSelectionId ||
      sourceSelection.storagePath !== resolvedStorage ||
      targetSelection.storagePath !== resolvedStorage
    ) {
      fail('invalidSelection')
    }
    if (!isValidStorageName(request.name)) fail('invalidName')
    if (!isValidConnectionId(request.id)) fail('invalidId')
    if (!isValidLinkName(request.linkName)) fail('invalidLinkName')

    const source = await inspectDirectPath(
      resolvedStorage,
      path.join(resolvedStorage, ...sourceSelection.relative.split('/')),
      { final: 'source' }
    )
    const targetParent = await inspectDirectPath(
      homePath,
      targetSelection.relative
        ? path.join(homePath, ...targetSelection.relative.split('/'))
        : homePath,
      { allowRoot: true }
    )
    const storage = await inspect(resolvedStorage, {
      homeDirectory: homePath,
      systemPlatform: platform
    })
    if (storage.platform !== 'macos') fail('unsupportedPlatform')
    if (storage.connections.length >= MAX_CONNECTIONS) fail('tooManyConnections')
    if (storage.connections.some(({ id }) => id === request.id)) fail('duplicateId')

    const targetRelative = [targetParent.relative, request.linkName].filter(Boolean).join('/')
    const target = `~/${targetRelative}`
    const targetPath = path.join(homePath, ...targetRelative.split('/'))
    if (overlaps(resolvedStorage, targetPath)) fail('targetOverlapsStorage')
    if (
      storage.connections.some(
        (connection) => connection.targetPath && overlaps(connection.targetPath, targetPath)
      )
    ) {
      fail('targetOverlap')
    }

    const connection = {
      id: request.id,
      name: request.name,
      source: source.relative,
      targets: { macos: target }
    }
    try {
      parseConfig(stringify({ version: 1, name: storage.name, connections: [connection] }))
    } catch {
      fail('invalidDraft')
    }

    return {
      status: 'ready',
      configPath: storage.configPath,
      connection,
      sourcePath: source.path,
      targetPath,
      yaml: stringify([connection], { lineWidth: 0 }).trimEnd()
    }
  }

  return Object.freeze({ clear, selectSource, selectTargetParent, preview })
}
