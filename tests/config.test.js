import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { stringify } from 'yaml'
import {
  CONFIG_FILENAME,
  ConfigError,
  MAX_CONFIG_BYTES,
  MAX_CONNECTIONS,
  parseConfig,
  isSafeRelativePath
} from '../src/shared/config.js'

function sampleConnection(overrides = {}) {
  return {
    id: 'editor',
    name: 'Editor settings',
    source: 'settings/editor',
    targets: { macos: '~/.config/editor' },
    ...overrides
  }
}

function sampleConfig(connections = [sampleConnection()]) {
  return { version: 1, name: 'My files', connections }
}

test('accepts the documented example and preserves platform-specific targets', async () => {
  const source = await readFile(new URL('../examples/yonder.yaml', import.meta.url), 'utf8')
  const config = parseConfig(source)

  assert.equal(config.version, 1)
  assert.equal(config.name, 'My files')
  assert.equal(config.connections.length, 2)
  assert.equal(config.connections[0].targets.windows, '~/Documents/Templates')
})

test('accepts an empty connection list and ordinary paths with spaces or Cyrillic', () => {
  assert.deepEqual(parseConfig(stringify(sampleConfig([]))).connections, [])
  assert.equal(isSafeRelativePath('Мои настройки/Editor settings'), true)
})

for (const value of [
  '',
  '../data',
  'data/../file',
  '/absolute',
  'C:/data',
  'data\\file',
  './data',
  'data//file',
  'data/',
  'bad\0name',
  'data/\u007f'
]) {
  test(`rejects unsafe relative path ${JSON.stringify(value)}`, () => {
    assert.equal(isSafeRelativePath(value), false)
  })
}

const invalidCases = [
  [
    'unsupportedVersion',
    (config) => {
      config.version = 2
    }
  ],
  [
    'invalidConnections',
    (config) => {
      config.connections = {}
    }
  ],
  [
    'invalidConnections',
    (config) => {
      config.connections = Array.from({ length: MAX_CONNECTIONS + 1 }, (_, index) =>
        sampleConnection({ id: `item-${index}`, targets: { macos: `~/item-${index}` } })
      )
    }
  ],
  [
    'invalidText',
    (config) => {
      config.name = ' My files '
    }
  ],
  [
    'invalidText',
    (config) => {
      config.connections[0].name = 'x'.repeat(241)
    }
  ],
  [
    'invalidId',
    (config) => {
      config.connections[0].id = 'Bad ID'
    }
  ],
  [
    'unknownField',
    (config) => {
      config.command = 'never-execute'
    }
  ],
  [
    'unknownField',
    (config) => {
      config.connections[0].targets.android = '~/example'
    }
  ],
  [
    'invalidTargets',
    (config) => {
      config.connections[0].targets = {}
    }
  ],
  [
    'unsafePath',
    (config) => {
      config.connections[0].targets.macos = '/tmp/example'
    }
  ],
  [
    'unsafePath',
    (config) => {
      config.connections[0].source = '../outside'
    }
  ],
  [
    'sourceIsConfig',
    (config) => {
      config.connections[0].source = CONFIG_FILENAME.toUpperCase()
    }
  ],
  [
    'duplicateId',
    (config) => {
      config.connections.push(sampleConnection({ targets: { macos: '~/other' } }))
    }
  ],
  [
    'overlappingTargets',
    (config) => {
      config.connections.push(sampleConnection({ id: 'second', targets: { macos: '~/.config' } }))
    }
  ],
  [
    'overlappingTargets',
    (config) => {
      config.connections.push(
        sampleConnection({ id: 'second', targets: { windows: '~/APPDATA/Editor' } })
      )
      config.connections[0].targets = { windows: '~/AppData/Editor' }
    }
  ]
]

for (const [index, [code, mutate]] of invalidCases.entries()) {
  test(`validates ${code} case ${index}`, () => {
    const config = sampleConfig()
    mutate(config)
    assert.throws(
      () => parseConfig(stringify(config)),
      (error) => error instanceof ConfigError && error.code === code
    )
  })
}

test('allows the same target on different platforms and case-distinct Linux targets', () => {
  const config = sampleConfig([
    sampleConnection({ targets: { macos: '~/Documents/Notes', linux: '~/Documents/Notes' } }),
    sampleConnection({
      id: 'second',
      source: 'other',
      targets: { linux: '~/documents/notes' }
    })
  ])

  assert.equal(parseConfig(stringify(config)).connections.length, 2)
})

test('rejects duplicate keys, anchors, aliases and custom tags without echoing input', () => {
  for (const source of [
    'version: 1\nname: one\nname: two\nconnections: []',
    'version: 1\nname: &private private-fixture-value\nconnections: []',
    'version: 1\nname: *private\nconnections: []',
    'version: 1\nname: !custom private-fixture-value\nconnections: []',
    'version: 1\nname: private-fixture-value\nconnections: ['
  ]) {
    assert.throws(
      () => parseConfig(source),
      (error) =>
        error instanceof ConfigError &&
        error.code === 'invalidYaml' &&
        !error.message.includes('private-fixture-value')
    )
  }
})

test('bounds the UTF-8 byte size, including multibyte input', () => {
  for (const source of ['x'.repeat(MAX_CONFIG_BYTES + 1), 'я'.repeat(MAX_CONFIG_BYTES)]) {
    assert.throws(() => parseConfig(source), { code: 'configTooLarge' })
  }
})
