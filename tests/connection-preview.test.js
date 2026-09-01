import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConnectionPreview } from '../src/shared/connection-preview.js'

function connection(state, readiness) {
  return {
    id: 'notes',
    name: 'Notes',
    sourcePath: '/fictional/storage/Notes',
    targetPath: '/fictional/home/Notes',
    state,
    readiness
  }
}

test('only a safely inspected missing target receives a display-only link proposal', () => {
  const input = Object.freeze(connection('targetMissing', Object.freeze({ status: 'ready' })))

  assert.deepEqual(buildConnectionPreview(input), {
    status: 'ready',
    operation: 'createLink',
    reason: ''
  })
  assert.equal(input.operation, undefined)
})

test('blocked readiness reasons remain explicit and never become operations', () => {
  for (const reason of [
    'targetParentMissing',
    'targetParentUnsafe',
    'sourceUnsafe',
    'sourceUnsupported',
    'inspectionFailed'
  ]) {
    assert.deepEqual(
      buildConnectionPreview(connection('targetMissing', { status: 'blocked', reason })),
      {
        status: 'blocked',
        operation: '',
        reason
      }
    )
  }
})

test('existing inspection states map to non-writing explanations', () => {
  for (const [state, reason] of [
    ['connected', 'connected'],
    ['targetOccupied', 'targetOccupied'],
    ['targetMismatch', 'targetMismatch'],
    ['sourceMissing', 'sourceMissing'],
    ['notConfigured', 'notConfigured'],
    ['inspectionFailed', 'inspectionFailed'],
    ['futureState', 'inspectionFailed']
  ]) {
    assert.equal(buildConnectionPreview(connection(state)).status, 'blocked')
    assert.equal(buildConnectionPreview(connection(state)).reason, reason)
  }
})

test('invalid snapshots have no preview', () => {
  for (const value of [null, {}, { id: 'notes' }, connection(undefined)]) {
    assert.equal(buildConnectionPreview(value), null)
  }
})
