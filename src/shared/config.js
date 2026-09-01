import { isAlias, parseDocument, visit } from 'yaml'

export const CONFIG_FILENAME = 'yonder.yaml'
export const MAX_CONFIG_BYTES = 256 * 1024
export const MAX_CONNECTIONS = 200
export const SUPPORTED_PLATFORMS = ['macos', 'linux', 'windows']

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasControlCharacters = (value) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint < 32 || codePoint === 127
  })

export class ConfigError extends Error {
  constructor(code, field = '') {
    super(code)
    this.name = 'ConfigError'
    this.code = code
    this.field = field
  }
}

function requireValue(condition, code, field = '') {
  if (!condition) throw new ConfigError(code, field)
}

function keysOnly(value, allowedKeys, field) {
  requireValue(isObject(value), 'invalidShape', field)
  const allowed = new Set(allowedKeys)
  requireValue(
    Object.keys(value).every((key) => allowed.has(key)),
    'unknownField',
    field
  )
}

function requireText(value, field) {
  requireValue(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 240 &&
      value === value.trim() &&
      !hasControlCharacters(value),
    'invalidText',
    field
  )
}

export function isSafeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/[\\:]/.test(value) &&
    !hasControlCharacters(value) &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

function parseYaml(source) {
  requireValue(typeof source === 'string', 'invalidYaml')
  requireValue(new TextEncoder().encode(source).length <= MAX_CONFIG_BYTES, 'configTooLarge')

  try {
    const document = parseDocument(source, { uniqueKeys: true, strict: true })
    if (document.errors.length || document.warnings.length) throw new Error('Invalid YAML')

    let forbiddenNode = false
    visit(document, (_key, node) => {
      if (isAlias(node) || node?.anchor || node?.tag) forbiddenNode = true
    })
    if (forbiddenNode) throw new Error('Unsupported YAML feature')

    return document.toJS({ maxAliasCount: 0 })
  } catch {
    // Never expose parser excerpts: a configuration may contain private names and paths.
    throw new ConfigError('invalidYaml')
  }
}

function comparableTarget(platform, target) {
  return platform === 'linux' ? target : target.normalize('NFC').toLowerCase()
}

export function parseConfig(source) {
  const data = parseYaml(source)
  keysOnly(data, ['version', 'name', 'connections'], 'config')
  requireValue(data.version === 1, 'unsupportedVersion', 'version')
  requireText(data.name, 'name')
  requireValue(
    Array.isArray(data.connections) && data.connections.length <= MAX_CONNECTIONS,
    'invalidConnections',
    'connections'
  )

  const ids = new Set()
  const destinations = Object.fromEntries(SUPPORTED_PLATFORMS.map((platform) => [platform, []]))
  const connections = data.connections.map((connection, index) => {
    const field = `connections[${index}]`
    keysOnly(connection, ['id', 'name', 'source', 'targets'], field)
    requireValue(
      typeof connection.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(connection.id),
      'invalidId',
      `${field}.id`
    )
    requireValue(!ids.has(connection.id), 'duplicateId', `${field}.id`)
    ids.add(connection.id)

    requireText(connection.name, `${field}.name`)
    requireValue(isSafeRelativePath(connection.source), 'unsafePath', `${field}.source`)
    requireValue(
      connection.source.toLowerCase() !== CONFIG_FILENAME,
      'sourceIsConfig',
      `${field}.source`
    )
    keysOnly(connection.targets, SUPPORTED_PLATFORMS, `${field}.targets`)
    requireValue(Object.keys(connection.targets).length > 0, 'invalidTargets', `${field}.targets`)

    const targets = {}
    for (const [platform, target] of Object.entries(connection.targets)) {
      requireValue(
        typeof target === 'string' &&
          target.startsWith('~/') &&
          isSafeRelativePath(target.slice(2)),
        'unsafePath',
        `${field}.targets.${platform}`
      )

      const comparable = comparableTarget(platform, target)
      const overlaps = destinations[platform].some(
        (other) =>
          other === comparable ||
          other.startsWith(`${comparable}/`) ||
          comparable.startsWith(`${other}/`)
      )
      requireValue(!overlaps, 'overlappingTargets', `${field}.targets.${platform}`)
      destinations[platform].push(comparable)
      targets[platform] = target
    }

    return {
      id: connection.id,
      name: connection.name,
      source: connection.source,
      targets
    }
  })

  return { version: 1, name: data.name, connections }
}
