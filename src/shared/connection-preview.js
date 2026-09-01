const STATE_REASONS = {
  connected: 'connected',
  targetMissing: 'inspectionFailed',
  targetOccupied: 'targetOccupied',
  targetMismatch: 'targetMismatch',
  sourceMissing: 'sourceMissing',
  notConfigured: 'notConfigured',
  inspectionFailed: 'inspectionFailed'
}

// Display-only description of one inspection snapshot. It is never write
// authority and must not be accepted by a future apply operation.
export function buildConnectionPreview(connection) {
  if (
    !connection ||
    typeof connection.id !== 'string' ||
    typeof connection.sourcePath !== 'string' ||
    typeof connection.targetPath !== 'string' ||
    typeof connection.state !== 'string'
  ) {
    return null
  }

  if (connection.state === 'targetMissing' && connection.readiness?.status === 'ready') {
    return { status: 'ready', operation: 'createLink', reason: '' }
  }

  const preciseReason =
    connection.readiness?.status === 'blocked' && typeof connection.readiness.reason === 'string'
      ? connection.readiness.reason
      : ''
  return {
    status: 'blocked',
    operation: '',
    reason: preciseReason || STATE_REASONS[connection.state] || 'inspectionFailed'
  }
}
