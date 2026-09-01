import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

if (process.platform === 'darwin') {
  const source = fileURLToPath(new URL('../native/link-helper.c', import.meta.url))
  const output = fileURLToPath(new URL('../build/native/yonder-link-helper', import.meta.url))

  await mkdir(dirname(output), { recursive: true })
  await promisify(execFile)(
    '/usr/bin/clang',
    ['-std=c11', '-Wall', '-Wextra', '-Werror', '-Wpedantic', '-O2', source, '-o', output],
    { timeout: 30_000, maxBuffer: 128 * 1024 }
  )
}
