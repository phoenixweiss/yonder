import { stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { CONFIG_FILENAME, ConfigError, createEmptyConfigSource } from '../shared/config.js'

export class StorageCreationError extends Error {
  constructor(code) {
    super(code)
    this.name = 'StorageCreationError'
    this.code = code
  }
}

export async function inspectStorageDirectory(directory) {
  const folderPath = resolve(directory)

  try {
    const details = await stat(folderPath)
    if (!details.isDirectory()) throw new StorageCreationError('invalidDirectory')
  } catch (error) {
    if (error instanceof StorageCreationError) throw error
    throw new StorageCreationError('invalidDirectory')
  }

  const configPath = join(folderPath, CONFIG_FILENAME)
  let configExists = false

  try {
    await stat(configPath)
    configExists = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new StorageCreationError('unavailable')
  }

  return {
    folderPath,
    configPath,
    defaultName: basename(folderPath) || 'Yonder storage',
    configExists
  }
}

export async function createStorageConfig(directory, name) {
  let source
  try {
    source = createEmptyConfigSource(name)
  } catch (error) {
    if (error instanceof ConfigError) throw new StorageCreationError('invalidName')
    throw error
  }

  const preview = await inspectStorageDirectory(directory)
  if (preview.configExists) throw new StorageCreationError('configExists')

  try {
    await writeFile(preview.configPath, source, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
  } catch (error) {
    if (error?.code === 'EEXIST') throw new StorageCreationError('configExists')
    throw new StorageCreationError('writeFailed')
  }

  return { ...preview, name, source }
}
