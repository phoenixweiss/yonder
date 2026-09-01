import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const fields = ['action', 'parent', 'device', 'inode', 'source', 'name']
const maxOutputBytes = 128

export class NativeLinkError extends Error {
  constructor(code) {
    super(code)
    this.name = 'NativeLinkError'
    this.code = code
  }
}

function fail(code) {
  throw new NativeLinkError(code)
}

function text(value, limit) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= limit &&
    value.isWellFormed() &&
    !value.includes('\0') &&
    Buffer.byteLength(value) <= limit
  )
}

function component(value) {
  return text(value, 255) && !['.', '..'].includes(value) && !value.includes('/')
}

function absolutePath(value) {
  return text(value, 1023) && value.startsWith('/') && value.slice(1).split('/').every(component)
}

function identity(value) {
  return (
    typeof value === 'string' &&
    /^[0-9]{1,20}$/.test(value) &&
    BigInt(value) <= 18446744073709551615n
  )
}

function encode(request) {
  if (
    !request ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(request)) ||
    Object.keys(request).length !== fields.length ||
    !Object.keys(request).every((key) => fields.includes(key))
  ) {
    fail('notReady')
  }
  request = Object.fromEntries(fields.map((key) => [key, request[key]]))
  if (
    !['create', 'remove'].includes(request.action) ||
    !absolutePath(request.parent) ||
    !absolutePath(request.source) ||
    !component(request.name) ||
    !identity(request.device) ||
    !identity(request.inode)
  ) {
    fail('notReady')
  }
  return Buffer.from(['yonder-link-v2', ...fields.map((key) => request[key]), ''].join('\0'))
}

export function createNativeLinkProcess({
  executable,
  platform = process.platform,
  spawnProcess = spawn,
  timeoutMs = 5000,
  idleTimeoutMs = 60000,
  shutdownTimeoutMs = 1000
} = {}) {
  if (
    !absolutePath(executable) ||
    ![timeoutMs, idleTimeoutMs, shutdownTimeoutMs].every(
      (value) => Number.isSafeInteger(value) && value > 0 && value <= 600000
    )
  ) {
    fail('notReady')
  }
  let active = null

  function start(input) {
    const action = input.action
    const operation = {
      action,
      phase: 'starting',
      token: randomUUID(),
      dispatched: false,
      exitSeen: false,
      closed: false,
      reason: '',
      reported: '',
      output: '',
      outputBytes: 0,
      ready: Promise.withResolvers(),
      done: Promise.withResolvers()
    }
    active = operation
    let child
    let deadline
    let shutdown

    function settle(code, result) {
      operation.ready.resolve(code ? { error: code } : result)
      operation.done.resolve(code ? { error: code } : result)
    }

    function kill(signal) {
      if (!child || operation.exitSeen || operation.closed) return
      try {
        child.kill(signal)
      } catch {
        // A signal is not proof of exit. Keep the slot occupied until close.
      }
    }

    function stop(code) {
      if (operation.closed || operation.reason) return
      operation.reason = operation.dispatched
        ? operation.action === 'create'
          ? 'creationUncertain'
          : 'removalUncertain'
        : code
      operation.token = null
      clearTimeout(deadline)
      shutdown = setTimeout(() => {
        kill('SIGKILL')
        settle(operation.reason)
      }, shutdownTimeoutMs)
      try {
        child?.stdin.destroy()
      } catch {
        // Never retry a possibly delivered confirmation.
      }
      kill('SIGTERM')
    }
    operation.stop = stop

    function arm(milliseconds) {
      clearTimeout(deadline)
      deadline = setTimeout(() => stop('notReady'), milliseconds)
    }

    function receive(chunk) {
      if (operation.reason || operation.closed) return
      operation.outputBytes += chunk.length
      if (operation.outputBytes > maxOutputBytes) return stop('notReady')
      if ([...chunk].some((byte) => byte > 127)) return stop('notReady')
      operation.output += chunk.toString('ascii')
      while (operation.output.includes('\n')) {
        const end = operation.output.indexOf('\n')
        const line = operation.output.slice(0, end)
        operation.output = operation.output.slice(end + 1)
        if (operation.reported) return stop('notReady')
        if (operation.phase === 'starting' && line === 'ready') {
          operation.phase = 'ready'
          arm(idleTimeoutMs)
          operation.ready.resolve({ token: operation.token })
        } else if (
          (operation.phase === 'starting' &&
            ['occupied', 'missing', 'mismatch', 'changed', 'rejected'].includes(line)) ||
          (operation.phase === 'confirming' &&
            [
              'created',
              'removed',
              'occupied',
              'missing',
              'mismatch',
              'changed',
              'rejected',
              'uncertain'
            ].includes(line))
        ) {
          operation.reported = line
        } else {
          return stop('notReady')
        }
      }
      if (operation.output && (operation.phase === 'ready' || operation.reported)) {
        stop('notReady')
      }
    }

    function close(code, signal) {
      operation.closed = true
      operation.token = null
      clearTimeout(deadline)
      clearTimeout(shutdown)
      if (active === operation) active = null
      let error =
        operation.reason ||
        (operation.dispatched
          ? operation.action === 'create'
            ? 'creationUncertain'
            : 'removalUncertain'
          : 'notReady')
      let result
      if (!operation.reason && !signal && !operation.output && operation.reported) {
        const expected = operation.action === 'create' ? 'created' : 'removed'
        if (operation.reported === expected && code === 0 && operation.dispatched) {
          error = ''
          result = { status: expected }
        } else if (code === 1 && operation.reported === 'occupied') {
          error = 'destinationOccupied'
        } else if (code === 1 && operation.reported === 'missing') {
          error = 'targetMissing'
        } else if (code === 1 && operation.reported === 'mismatch') {
          error = 'targetMismatch'
        } else if (code === 1 && operation.reported === 'changed') {
          error = 'stateChanged'
        }
      }
      settle(error, result)
    }

    try {
      child = spawnProcess(executable, [], {
        cwd: '/',
        env: { LANG: 'C', LC_ALL: 'C' },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      child.on('error', () => stop('notReady'))
      child.on('exit', () => {
        operation.exitSeen = true
        if (!operation.dispatched && !operation.reported) stop('notReady')
      })
      child.on('close', close)
      child.stdin.on('error', () => stop('notReady'))
      child.stdout.on('error', () => stop('notReady'))
      child.stderr.on('error', () => stop('notReady'))
      child.stdout.on('data', receive)
      child.stderr.on('data', () => stop('notReady'))
      arm(timeoutMs)
      child.stdin.write(input.bytes, (error) => {
        if (error) stop('notReady')
      })
    } catch {
      if (child) stop('notReady')
      else close(null, null)
    }

    operation.confirm = () => {
      operation.token = null
      operation.dispatched = true
      operation.phase = 'confirming'
      arm(timeoutMs)
      try {
        child.stdin.end('confirm\n', (error) => {
          if (error) stop('notReady')
        })
      } catch {
        stop('notReady')
      }
    }
    return operation
  }

  async function prepare(request) {
    if (platform !== 'darwin') fail('unsupportedPlatform')
    if (active) fail('operationBusy')
    const operation = start({ action: request.action, bytes: encode(request) })
    const result = await operation.ready.promise
    if (result.error) fail(result.error)
    if (operation.reason || operation.closed || active !== operation)
      fail(operation.reason || 'notReady')
    return result
  }

  async function confirm(token) {
    const operation = active
    if (
      typeof token !== 'string' ||
      !operation ||
      operation.phase !== 'ready' ||
      operation.token !== token ||
      operation.reason ||
      operation.exitSeen
    ) {
      fail('selectionExpired')
    }
    operation.confirm()
    const result = await operation.done.promise
    if (result.error) fail(result.error)
    return result
  }

  async function clear() {
    const operation = active
    if (!operation) return { status: 'idle' }
    operation.stop('cancelled')
    const result = await operation.done.promise
    if (result.error && result.error !== 'cancelled') fail(result.error)
    return { status: 'cancelled' }
  }

  return Object.freeze({ prepare, confirm, clear })
}
