import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export async function nativeHelperFixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'yonder-native-build-'))
  const executable = path.join(root, 'yonder-link-helper')
  const cleanup = () => fs.rm(root, { recursive: true, force: true })
  try {
    await promisify(execFile)(
      '/usr/bin/clang',
      [
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-Wpedantic',
        '-O2',
        '-fsanitize=address,undefined',
        '-fno-sanitize-recover=all',
        fileURLToPath(new URL('../../native/link-helper.c', import.meta.url)),
        '-o',
        executable
      ],
      { timeout: 30_000, maxBuffer: 128 * 1024 }
    )
  } catch (error) {
    await cleanup()
    throw error
  }
  return { executable, cleanup }
}
