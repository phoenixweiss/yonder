// Do not interleave storage selection, cancellation, or another write with a
// multi-step confirmed operation. Busy requests are rejected, never queued.
export function createOperationGate() {
  let busy = false
  return async (action) => {
    if (busy) return { status: 'operationBusy' }
    busy = true
    try {
      return await action()
    } finally {
      busy = false
    }
  }
}
