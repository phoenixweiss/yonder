import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { nativeHelperFixture } from './helpers/native-helper.js'

const mac = { skip: process.platform !== 'darwin' }
let build

before(async () => {
  if (!mac.skip) build = await nativeHelperFixture()
})

after(async () => build?.cleanup())

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'yonder-helper-test-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const parent = path.join(root, 'home', 'settings')
  const source = path.join(root, 'storage', 'source')
  const target = path.join(parent, 'target')
  await fs.mkdir(parent, { recursive: true })
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.writeFile(source, 'fixture')
  const stat = await fs.lstat(parent, { bigint: true })
  return {
    root,
    parent,
    source,
    target,
    request: {
      parent,
      device: String(stat.dev),
      inode: String(stat.ino),
      source,
      name: path.basename(target)
    }
  }
}

function encode(request) {
  return Buffer.from(
    [
      'yonder-link-v1',
      request.parent,
      request.device,
      request.inode,
      request.source,
      request.name,
      ''
    ].join('\0')
  )
}

function start(request) {
  const child = spawn(build.executable, [], {
    cwd: '/',
    env: { LANG: 'C', LC_ALL: 'C' },
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  const ready = Promise.withResolvers()
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    if (stdout.includes('\n')) ready.resolve(stdout.split('\n')[0])
  })
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
  child.stdin.write(encode(request))
  return { child, ready: ready.promise, finished }
}

test('native helper creates exactly one confirmed symbolic link', mac, async (t) => {
  const f = await fixture(t)
  const session = start(f.request)
  assert.equal(await session.ready, 'ready')
  await assert.rejects(fs.lstat(f.target), { code: 'ENOENT' })
  session.child.stdin.end('confirm\n')
  assert.deepEqual(await session.finished, {
    code: 0,
    signal: null,
    stdout: 'ready\ncreated\n',
    stderr: ''
  })
  assert.equal(await fs.readlink(f.target), f.source)
})

test('cancellation and conflicts leave existing filesystem entries unchanged', mac, async (t) => {
  const f = await fixture(t)
  const cancelled = start(f.request)
  assert.equal(await cancelled.ready, 'ready')
  cancelled.child.stdin.end('')
  assert.equal((await cancelled.finished).stdout, 'ready\ncancelled\n')
  await assert.rejects(fs.lstat(f.target), { code: 'ENOENT' })

  await fs.writeFile(f.target, 'keep me')
  const occupied = start(f.request)
  occupied.child.stdin.end('confirm\n')
  assert.deepEqual(await occupied.finished, {
    code: 1,
    signal: null,
    stdout: 'occupied\n',
    stderr: ''
  })
  assert.equal(await fs.readFile(f.target, 'utf8'), 'keep me')
})

test('an anchored parent replacement never redirects the write', mac, async (t) => {
  const f = await fixture(t)
  const substitute = path.join(f.root, 'substitute')
  const moved = `${f.parent}-moved`
  await fs.mkdir(substitute)
  const session = start(f.request)
  assert.equal(await session.ready, 'ready')
  await fs.rename(f.parent, moved)
  await fs.symlink(substitute, f.parent)
  session.child.stdin.end('confirm\n')
  assert.deepEqual(await session.finished, {
    code: 1,
    signal: null,
    stdout: 'ready\nuncertain\n',
    stderr: ''
  })
  assert.deepEqual(await fs.readdir(substitute), [])
  assert.equal(await fs.readlink(path.join(moved, path.basename(f.target))), f.source)
})
