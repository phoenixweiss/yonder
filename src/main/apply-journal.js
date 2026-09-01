import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_RECORD_BYTES = 64 * 1024
const MAX_RECORDS = 512
const identityFields = ['dev', 'ino']
const sourceFields = [...identityFields, 'mode', 'size', 'mtimeNs', 'ctimeNs', 'nlink']

export class ApplyJournalError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ApplyJournalError'
    this.code = code
  }
}

function fail(code) {
  throw new ApplyJournalError(code)
}

function keys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  )
}

function uuid(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
}

function timestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    new Date(value).toISOString() === value
  )
}

function integer(value) {
  return (
    typeof value === 'string' &&
    /^(0|[1-9][0-9]{0,19})$/.test(value) &&
    BigInt(value) <= 18446744073709551615n
  )
}

function digest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function absolutePath(value, allowRoot = false) {
  return (
    typeof value === 'string' &&
    value.isWellFormed() &&
    Buffer.byteLength(value) <= 4095 &&
    ((allowRoot && value === '/') ||
      (value.startsWith('/') &&
        value
          .slice(1)
          .split('/')
          .every((part) => part && !['.', '..'].includes(part)))) &&
    ![...value].some((character) => {
      const code = character.codePointAt(0)
      return code < 32 || code === 127
    })
  )
}

function validMetadata(value, fields) {
  return keys(value, fields) && fields.every((field) => integer(value[field]))
}

function validSelection(value) {
  return (
    keys(value, [
      'storagePath',
      'homePath',
      'connectionId',
      'sourcePath',
      'targetPath',
      'configuration',
      'source',
      'directories'
    ]) &&
    [value.storagePath, value.homePath, value.sourcePath, value.targetPath].every(absolutePath) &&
    typeof value.connectionId === 'string' &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(value.connectionId) &&
    keys(value.configuration, ['hash', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) &&
    digest(value.configuration.hash) &&
    ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((field) =>
      integer(value.configuration[field])
    ) &&
    validMetadata(value.source, sourceFields) &&
    value.source.nlink !== '0' &&
    Array.isArray(value.directories) &&
    value.directories.length > 0 &&
    value.directories.length <= 128 &&
    value.directories.every(
      (entry) =>
        keys(entry, ['path', ...identityFields]) &&
        absolutePath(entry.path, true) &&
        identityFields.every((field) => integer(entry[field]))
    ) &&
    new Set(value.directories.map(({ path: directory }) => directory)).size ===
      value.directories.length &&
    value.sourcePath.startsWith(`${value.storagePath}/`) &&
    value.targetPath.startsWith(`${value.homePath}/`)
  )
}

function validIntent(value) {
  return (
    keys(value, ['version', 'id', 'createdAt', 'selection']) &&
    value.version === 1 &&
    uuid(value.id) &&
    timestamp(value.createdAt) &&
    validSelection(value.selection)
  )
}

function validOutcome(value, resolution = false) {
  const outcomes = resolution ? ['connected'] : ['connected', 'notApplied', 'uncertain']
  return (
    keys(value, ['version', 'operationId', 'intentHash', 'recordedAt', 'outcome']) &&
    value.version === 1 &&
    uuid(value.operationId) &&
    digest(value.intentHash) &&
    timestamp(value.recordedAt) &&
    outcomes.includes(value.outcome)
  )
}

function encode(value, validator) {
  if (!validator(value)) fail('journalInvalid')
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  if (bytes.length > MAX_RECORD_BYTES) fail('journalInvalid')
  return bytes
}

function decode(bytes, validator) {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!encode(value, validator).equals(bytes)) fail('journalInvalid')
    return value
  } catch (error) {
    if (error instanceof ApplyJournalError) throw error
    fail('journalInvalid')
  }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function privateDirectory(stat) {
  return stat.isDirectory() && stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n
}

function privateFile(stat) {
  return (
    stat.isFile() &&
    stat.nlink === 1n &&
    stat.uid === BigInt(process.getuid()) &&
    (stat.mode & 0o177n) === 0n
  )
}

function recordName(id, type) {
  return `${id}.${type}.json`
}

// Append-only, main-process-only operation journal. Records never authorize a
// write by themselves; they only block blind retries and support observation.
export async function openApplyJournal(root, { platform = process.platform } = {}) {
  if (platform !== 'darwin' || !absolutePath(root)) fail('journalUnavailable')

  try {
    await fs.mkdir(root, { mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') fail('journalUnavailable')
  }

  let rootIdentity
  try {
    const stat = await fs.lstat(root, { bigint: true })
    if (!privateDirectory(stat) || (await fs.realpath(root)) !== root) fail('journalUnavailable')
    rootIdentity = { dev: stat.dev, ino: stat.ino }
  } catch {
    fail('journalUnavailable')
  }

  let busy = false

  async function verifyRoot() {
    const stat = await fs.lstat(root, { bigint: true })
    if (
      !privateDirectory(stat) ||
      stat.dev !== rootIdentity.dev ||
      stat.ino !== rootIdentity.ino ||
      (await fs.realpath(root)) !== root
    ) {
      fail('journalChanged')
    }
  }

  async function exclusive(action) {
    if (busy) fail('journalBusy')
    busy = true
    try {
      await verifyRoot()
      return await action()
    } catch (error) {
      if (error instanceof ApplyJournalError) throw error
      fail('journalUnavailable')
    } finally {
      busy = false
    }
  }

  async function readRecord(filename, validator) {
    await verifyRoot()
    let initial
    try {
      initial = await fs.lstat(path.join(root, filename), { bigint: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
    if (!privateFile(initial) || initial.size > BigInt(MAX_RECORD_BYTES)) fail('journalInvalid')
    const handle = await fs.open(
      path.join(root, filename),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      const opened = await handle.stat({ bigint: true })
      if (!privateFile(opened) || opened.dev !== initial.dev || opened.ino !== initial.ino) {
        fail('journalChanged')
      }
      const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1)
      let bytesRead = 0
      while (bytesRead < bytes.length) {
        const result = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead)
        if (!result.bytesRead) break
        bytesRead += result.bytesRead
      }
      const after = await handle.stat({ bigint: true })
      const current = await fs.lstat(path.join(root, filename), { bigint: true })
      await verifyRoot()
      if (
        bytesRead > MAX_RECORD_BYTES ||
        !privateFile(current) ||
        opened.dev !== current.dev ||
        opened.ino !== current.ino ||
        ['size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'].some(
          (field) => opened[field] !== after[field] || opened[field] !== current[field]
        )
      ) {
        fail('journalChanged')
      }
      const content = bytes.subarray(0, bytesRead)
      return { value: decode(content, validator), hash: hash(content) }
    } finally {
      await handle.close()
    }
  }

  async function records() {
    await verifyRoot()
    const entries = await fs.readdir(root, { withFileTypes: true })
    if (entries.length > MAX_RECORDS * 3) fail('journalInvalid')
    const groups = new Map()
    for (const entry of entries) {
      const match = /^([a-f0-9-]{36})\.(intent|result|resolution)\.json$/.exec(entry.name)
      if (!entry.isFile() || !match || !uuid(match[1])) fail('journalInvalid')
      const group = groups.get(match[1]) ?? {}
      if (group[match[2]]) fail('journalInvalid')
      group[match[2]] = entry.name
      groups.set(match[1], group)
    }
    if (groups.size > MAX_RECORDS) fail('journalInvalid')

    const result = []
    for (const [id, files] of groups) {
      if (!files.intent) fail('journalInvalid')
      const intent = await readRecord(files.intent, validIntent)
      const outcome = files.result
        ? await readRecord(files.result, (value) => validOutcome(value))
        : null
      const resolution = files.resolution
        ? await readRecord(files.resolution, (value) => validOutcome(value, true))
        : null
      if (!intent || intent.value.id !== id) fail('journalInvalid')
      for (const record of [outcome, resolution].filter(Boolean)) {
        if (
          record.value.operationId !== id ||
          record.value.intentHash !== intent.hash ||
          record.value.recordedAt < intent.value.createdAt
        ) {
          fail('journalInvalid')
        }
      }
      if (resolution && outcome && outcome.value.outcome !== 'uncertain') fail('journalInvalid')
      result.push({ intent, outcome, resolution })
    }
    await verifyRoot()
    return result
  }

  function unresolvedEntry(all) {
    const unresolved = all.filter(
      ({ outcome, resolution }) =>
        !resolution && (!outcome || outcome.value.outcome === 'uncertain')
    )
    if (unresolved.length > 1) fail('journalInvalid')
    return unresolved[0] ?? null
  }

  async function writeRecord(filename, bytes) {
    await verifyRoot()
    let folder
    let handle
    let attempted = false
    try {
      folder = await fs.open(
        root,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      )
      const openedRoot = await folder.stat({ bigint: true })
      if (openedRoot.dev !== rootIdentity.dev || openedRoot.ino !== rootIdentity.ino) {
        fail('journalChanged')
      }
      attempted = true
      handle = await fs.open(
        path.join(root, filename),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      )
      await handle.writeFile(bytes)
      await handle.sync()
      await folder.sync()
      await handle.close()
      handle = null
      await folder.close()
      folder = null
      await verifyRoot()
    } catch (error) {
      await handle?.close().catch(() => {})
      await folder?.close().catch(() => {})
      if (error?.code === 'EEXIST') fail('journalOccupied')
      if (attempted) fail('journalWriteUncertain')
      throw error
    }
  }

  function readUnresolved() {
    return exclusive(async () => {
      const entry = unresolvedEntry(await records())
      if (!entry) return { status: 'clear' }
      return {
        status: 'unresolved',
        operation: structuredClone(entry.intent.value),
        outcome: entry.outcome?.value.outcome ?? 'unknown'
      }
    })
  }

  function begin(selection) {
    let operation
    try {
      operation = {
        version: 1,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        selection: structuredClone(selection)
      }
    } catch {
      fail('journalInvalid')
    }
    const bytes = encode(operation, validIntent)
    return exclusive(async () => {
      if (unresolvedEntry(await records())) fail('recoveryRequired')
      await writeRecord(recordName(operation.id, 'intent'), bytes)
      const saved = await readRecord(recordName(operation.id, 'intent'), validIntent)
      if (!saved || saved.hash !== hash(bytes)) fail('journalWriteUncertain')
      return { operation: structuredClone(operation), intentHash: saved.hash }
    })
  }

  function recordOutcome(operationId, outcome) {
    return exclusive(async () => {
      if (!uuid(operationId) || !['connected', 'notApplied', 'uncertain'].includes(outcome)) {
        fail('journalInvalid')
      }
      const all = await records()
      const entry = all.find(({ intent }) => intent.value.id === operationId)
      if (!entry || entry.outcome || entry.resolution) fail('journalChanged')
      const value = {
        version: 1,
        operationId,
        intentHash: entry.intent.hash,
        recordedAt: new Date().toISOString(),
        outcome
      }
      const filename = recordName(operationId, 'result')
      const bytes = encode(value, validOutcome)
      await writeRecord(filename, bytes)
      const saved = await readRecord(filename, validOutcome)
      if (!saved || saved.hash !== hash(bytes)) fail('journalWriteUncertain')
      return structuredClone(value)
    })
  }

  function resolveConnected(operationId) {
    return exclusive(async () => {
      if (!uuid(operationId)) fail('journalInvalid')
      const all = await records()
      const entry = all.find(({ intent }) => intent.value.id === operationId)
      if (
        !entry ||
        entry.resolution ||
        (entry.outcome && entry.outcome.value.outcome !== 'uncertain')
      ) {
        fail('journalChanged')
      }
      const value = {
        version: 1,
        operationId,
        intentHash: entry.intent.hash,
        recordedAt: new Date().toISOString(),
        outcome: 'connected'
      }
      const filename = recordName(operationId, 'resolution')
      const validator = (record) => validOutcome(record, true)
      const bytes = encode(value, validator)
      await writeRecord(filename, bytes)
      const saved = await readRecord(filename, validator)
      if (!saved || saved.hash !== hash(bytes)) fail('journalWriteUncertain')
      return structuredClone(value)
    })
  }

  await verifyRoot()
  return Object.freeze({ readUnresolved, begin, recordOutcome, resolveConnected })
}
