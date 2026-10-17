import { createHash } from 'node:crypto'
import path from 'node:path'
import { ConnectionApplyError } from './connection-apply.js'

// This adapter is main-only. It binds the post-save apply snapshot to the reviewed
// source and parent, allowing only the explicitly reviewed configuration change.
export function createSaveAndConnect({ applyController, homeDirectory }) {
  return {
    async preflight() {
      if (!applyController) throw new ConnectionApplyError('journalUnavailable')
      await applyController.checkRecovery()
    },
    async connect(candidate) {
      const preview = candidate.preview
      const expectedHash = createHash('sha256').update(candidate.resultingSource).digest('hex')
      const prepared = await applyController.prepare(
        candidate.storagePath,
        preview.connection.id,
        homeDirectory,
        ({ selection }) => {
          const parent = selection.directories.find(
            (entry) => entry.path === path.dirname(preview.targetPath)
          )
          if (
            selection.configuration.hash !== expectedHash ||
            selection.sourcePath !== preview.sourcePath ||
            selection.targetPath !== preview.targetPath ||
            Object.entries(selection.source).some(
              ([key, value]) => candidate.selection.source[key] !== value
            ) ||
            !parent ||
            parent.dev !== candidate.selection.targetParent.dev ||
            parent.ino !== candidate.selection.targetParent.ino
          ) {
            throw new ConnectionApplyError('stateChanged')
          }
        }
      )
      return applyController.confirm(prepared.token)
    }
  }
}
