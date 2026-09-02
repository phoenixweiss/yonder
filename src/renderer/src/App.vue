<script setup>
import { computed, ref } from 'vue'
import { isValidStorageName } from '../../shared/config.js'
import {
  isValidConnectionId,
  isValidLinkName,
  suggestConnectionId
} from '../../shared/connection-draft.js'
import { buildConnectionPreview } from '../../shared/connection-preview.js'
import brandLockupUrl from './assets/yonder-lockup.svg'
import i18next, {
  changeLanguagePreference,
  languagePreference,
  languageSaveFailed
} from './i18n.js'

const view = ref('welcome')
const noticeKey = ref('')
const creationErrorKey = ref('')
const creationOpenErrorKey = ref('')
const openAfterCreation = ref(false)
const busy = ref(false)
const checking = ref(false)
const storageId = ref('')
const storage = ref(null)
const selectedPreview = ref(null)
const applyPreparation = ref(null)
const applyError = ref({ key: '', recovery: null })
const applyBusy = ref(false)
const selectedDisconnect = ref(null)
const disconnectPreparation = ref(null)
const disconnectErrorKey = ref('')
const disconnectBusy = ref(false)
const selectedRemoval = ref(null)
const removalPreparation = ref(null)
const removalErrorKey = ref('')
const removalBusy = ref(false)
const dashboardNoticeKey = ref('')
const connectionDraftBusy = ref(false)
const connectionDraftErrorKey = ref('')
const connectionDraftIdEdited = ref(false)
const connectionDraftLinkNameEdited = ref(false)
const connectionDraftPreview = ref(null)
const connectionDraftPreparation = ref(null)
const connectionDraftWriteErrorKey = ref('')
const inspectionError = ref({ key: '', path: '', previousResults: false })
const creation = ref({
  selectionId: '',
  folderPath: '',
  configPath: '',
  name: ''
})
const connectionDraft = ref(emptyConnectionDraft())

const nameIsValid = computed(() => isValidStorageName(creation.value.name))
const connectedCount = computed(
  () => storage.value?.connections.filter(({ state }) => state === 'connected').length ?? 0
)
const attentionCount = computed(
  () =>
    storage.value?.connections.filter(
      ({ state }) => !['connected', 'notConfigured'].includes(state)
    ).length ?? 0
)
const connectionDraftIsValid = computed(() =>
  Boolean(
    isValidStorageName(connectionDraft.value.name) &&
    isValidConnectionId(connectionDraft.value.id) &&
    isValidLinkName(connectionDraft.value.linkName) &&
    connectionDraft.value.sourceSelectionId &&
    connectionDraft.value.targetSelectionId
  )
)

function emptyConnectionDraft() {
  return {
    name: '',
    id: '',
    sourceSelectionId: '',
    sourceRelativePath: '',
    sourceDisplayPath: '',
    sourceType: '',
    targetSelectionId: '',
    targetRelativePath: '',
    targetDisplayPath: '',
    linkName: ''
  }
}

function resetConnectionDraft() {
  connectionDraft.value = emptyConnectionDraft()
  connectionDraftBusy.value = false
  connectionDraftErrorKey.value = ''
  connectionDraftIdEdited.value = false
  connectionDraftLinkNameEdited.value = false
  connectionDraftPreview.value = null
  connectionDraftPreparation.value = null
  connectionDraftWriteErrorKey.value = ''
}

function inspectionErrorKey(status) {
  const keys = {
    missingConfig: 'inspection.errors.missingConfig',
    invalidConfig: 'inspection.errors.invalidConfig',
    invalidSelection: 'inspection.errors.invalidSelection'
  }
  return keys[status] ?? 'inspection.errors.unavailable'
}

function showWelcome() {
  view.value = 'welcome'
  creationErrorKey.value = ''
  creationOpenErrorKey.value = ''
  openAfterCreation.value = false
  inspectionError.value = { key: '', path: '', previousResults: false }
  selectedPreview.value = null
  applyPreparation.value = null
  applyError.value = { key: '', recovery: null }
  selectedDisconnect.value = null
  disconnectPreparation.value = null
  disconnectErrorKey.value = ''
  selectedRemoval.value = null
  removalPreparation.value = null
  removalErrorKey.value = ''
  dashboardNoticeKey.value = ''
  resetConnectionDraft()
  creation.value = { selectionId: '', folderPath: '', configPath: '', name: '' }
}

async function openStorage() {
  noticeKey.value = ''
  dashboardNoticeKey.value = ''
  inspectionError.value = { key: '', path: '', previousResults: false }
  busy.value = true

  try {
    const result = await window.yonder.chooseStorageFolderForOpening(i18next.resolvedLanguage)
    if (result.status === 'cancelled') return
    if (result.status === 'opened') {
      storageId.value = result.storageId
      storage.value = result.storage
      selectedPreview.value = null
      applyPreparation.value = null
      applyError.value = { key: '', recovery: null }
      selectedDisconnect.value = null
      disconnectPreparation.value = null
      disconnectErrorKey.value = ''
      selectedRemoval.value = null
      removalPreparation.value = null
      removalErrorKey.value = ''
      resetConnectionDraft()
      view.value = 'dashboard'
      return
    }
    inspectionError.value = {
      key: inspectionErrorKey(result.status),
      path: result.configPath ?? result.folderPath ?? '',
      previousResults: view.value === 'dashboard'
    }
  } catch {
    inspectionError.value = {
      key: 'inspection.errors.unavailable',
      path: '',
      previousResults: view.value === 'dashboard'
    }
  } finally {
    busy.value = false
  }
}

function connectionDraftError(status) {
  const keys = {
    invalidSelection: 'connectionDraft.errors.invalidSelection',
    unsupportedPlatform: 'connectionDraft.errors.unsupportedPlatform',
    sourceOutsideStorage: 'connectionDraft.errors.sourceOutsideStorage',
    sourceUnsafe: 'connectionDraft.errors.sourceUnsafe',
    sourceUnsupported: 'connectionDraft.errors.sourceUnsupported',
    targetOutsideHome: 'connectionDraft.errors.targetOutsideHome',
    targetParentUnsafe: 'connectionDraft.errors.targetParentUnsafe',
    invalidName: 'connectionDraft.errors.invalidName',
    invalidId: 'connectionDraft.errors.invalidId',
    duplicateId: 'connectionDraft.errors.duplicateId',
    invalidLinkName: 'connectionDraft.errors.invalidLinkName',
    targetOverlap: 'connectionDraft.errors.targetOverlap',
    targetOverlapsStorage: 'connectionDraft.errors.targetOverlapsStorage',
    tooManyConnections: 'connectionDraft.errors.tooManyConnections',
    invalidDraft: 'connectionDraft.errors.invalidDraft',
    selectionExpired: 'connectionDraft.errors.selectionExpired',
    operationBusy: 'connectionDraft.errors.operationBusy',
    stateChanged: 'connectionDraft.errors.stateChanged',
    writeFailed: 'connectionDraft.errors.writeFailed',
    writeUncertain: 'connectionDraft.errors.writeUncertain'
  }
  return keys[status] ?? 'connectionDraft.errors.unavailable'
}

function showConnectionDraft() {
  resetConnectionDraft()
  connectionDraft.value.id = suggestConnectionId(
    '',
    storage.value.connections.map(({ id }) => id)
  )
  view.value = 'connection-draft'
}

function updateConnectionDraftName() {
  connectionDraftErrorKey.value = ''
  if (connectionDraftIdEdited.value) return
  connectionDraft.value.id = suggestConnectionId(
    connectionDraft.value.name,
    storage.value.connections.map(({ id }) => id)
  )
}

function editConnectionDraftId() {
  connectionDraftIdEdited.value = true
  connectionDraftErrorKey.value = ''
}

function editConnectionDraftLinkName() {
  connectionDraftLinkNameEdited.value = true
  connectionDraftErrorKey.value = ''
}

async function chooseConnectionDraftSource() {
  if (connectionDraftBusy.value) return
  connectionDraftErrorKey.value = ''
  connectionDraftBusy.value = true
  try {
    const result = await window.yonder.chooseConnectionDraftSource(
      storageId.value,
      i18next.resolvedLanguage
    )
    if (result.status === 'cancelled') return
    if (result.status !== 'ready') {
      connectionDraftErrorKey.value = connectionDraftError(result.status)
      return
    }
    connectionDraft.value.sourceSelectionId = result.selectionId
    connectionDraft.value.sourceRelativePath = result.relativePath
    connectionDraft.value.sourceDisplayPath = result.displayPath
    connectionDraft.value.sourceType = result.sourceType
    if (!connectionDraftLinkNameEdited.value) {
      connectionDraft.value.linkName = result.defaultLinkName
    }
  } catch {
    connectionDraftErrorKey.value = 'connectionDraft.errors.unavailable'
  } finally {
    connectionDraftBusy.value = false
  }
}

async function chooseConnectionDraftTargetParent() {
  if (connectionDraftBusy.value) return
  connectionDraftErrorKey.value = ''
  connectionDraftBusy.value = true
  try {
    const result = await window.yonder.chooseConnectionDraftTargetParent(
      storageId.value,
      i18next.resolvedLanguage
    )
    if (result.status === 'cancelled') return
    if (result.status !== 'ready') {
      connectionDraftErrorKey.value = connectionDraftError(result.status)
      return
    }
    connectionDraft.value.targetSelectionId = result.selectionId
    connectionDraft.value.targetRelativePath = result.relativePath
    connectionDraft.value.targetDisplayPath = result.displayPath
  } catch {
    connectionDraftErrorKey.value = 'connectionDraft.errors.unavailable'
  } finally {
    connectionDraftBusy.value = false
  }
}

async function previewConnectionDraft() {
  if (!connectionDraftIsValid.value || connectionDraftBusy.value) return
  connectionDraftErrorKey.value = ''
  connectionDraftBusy.value = true
  try {
    const result = await window.yonder.previewConnectionDraft(
      storageId.value,
      connectionDraft.value.sourceSelectionId,
      connectionDraft.value.targetSelectionId,
      connectionDraft.value.name,
      connectionDraft.value.id,
      connectionDraft.value.linkName
    )
    if (result.status !== 'ready') {
      connectionDraftErrorKey.value = connectionDraftError(result.status)
      return
    }
    connectionDraftPreview.value = result
    connectionDraftPreparation.value = null
    connectionDraftWriteErrorKey.value = ''
    view.value = 'connection-draft-preview'
  } catch {
    connectionDraftErrorKey.value = 'connectionDraft.errors.unavailable'
  } finally {
    connectionDraftBusy.value = false
  }
}

async function prepareConnectionDraftWrite() {
  if (!connectionDraftPreview.value || connectionDraftBusy.value) return
  connectionDraftWriteErrorKey.value = ''
  connectionDraftBusy.value = true
  try {
    const result = await window.yonder.prepareConnectionDraftWrite(
      storageId.value,
      connectionDraft.value.sourceSelectionId,
      connectionDraft.value.targetSelectionId,
      connectionDraft.value.name,
      connectionDraft.value.id,
      connectionDraft.value.linkName
    )
    if (result.status !== 'ready') {
      connectionDraftWriteErrorKey.value = connectionDraftError(result.status)
      return
    }
    connectionDraftPreparation.value = result
  } catch {
    connectionDraftWriteErrorKey.value = 'connectionDraft.errors.unavailable'
  } finally {
    connectionDraftBusy.value = false
  }
}

async function confirmConnectionDraftWrite() {
  if (!connectionDraftPreparation.value || connectionDraftBusy.value) return
  const token = connectionDraftPreparation.value.token
  connectionDraftWriteErrorKey.value = ''
  connectionDraftBusy.value = true
  try {
    const result = await window.yonder.confirmConnectionDraftWrite(token)
    connectionDraftPreparation.value = null
    if (result.status === 'created') {
      if (result.storageId && result.storage) {
        storageId.value = result.storageId
        storage.value = result.storage
        dashboardNoticeKey.value = 'connectionDraft.created'
      } else {
        dashboardNoticeKey.value = 'connectionDraft.createdRefreshFailed'
      }
      resetConnectionDraft()
      view.value = 'dashboard'
      return
    }
    if (result.status === 'writeUncertain') {
      inspectionError.value = {
        key: 'connectionDraft.errors.writeUncertain',
        path: storage.value?.configPath ?? '',
        previousResults: true
      }
      resetConnectionDraft()
      view.value = 'dashboard'
      return
    }
    connectionDraftWriteErrorKey.value = connectionDraftError(result.status)
  } catch {
    connectionDraftPreparation.value = null
    connectionDraftWriteErrorKey.value = 'connectionDraft.errors.unavailable'
  } finally {
    connectionDraftBusy.value = false
  }
}

async function cancelConnectionDraftPreparation() {
  if (!connectionDraftPreparation.value) return true
  const token = connectionDraftPreparation.value.token
  connectionDraftWriteErrorKey.value = ''
  connectionDraftBusy.value = true
  try {
    const result = await window.yonder.cancelConnectionDraftWrite(token)
    if (!['cancelled', 'selectionExpired', 'invalidSelection'].includes(result.status)) {
      connectionDraftWriteErrorKey.value = connectionDraftError(result.status)
      return false
    }
    connectionDraftPreparation.value = null
    return true
  } catch {
    connectionDraftWriteErrorKey.value = 'connectionDraft.errors.unavailable'
    return false
  } finally {
    connectionDraftBusy.value = false
  }
}

async function editConnectionDraft() {
  if (!(await cancelConnectionDraftPreparation())) return
  connectionDraftPreview.value = null
  connectionDraftErrorKey.value = ''
  connectionDraftWriteErrorKey.value = ''
  view.value = 'connection-draft'
}

async function closeConnectionDraft() {
  if (!(await cancelConnectionDraftPreparation())) return
  resetConnectionDraft()
  view.value = 'dashboard'
}

function connectionPreview(connection) {
  return buildConnectionPreview(connection)
}

function showConnectionPreview(connection) {
  const preview = connectionPreview(connection)
  if (preview?.status !== 'ready') return
  selectedPreview.value = { connection, preview }
  applyPreparation.value = null
  applyError.value = { key: '', recovery: null }
  view.value = 'preview'
}

function connectionApplyErrorKey(status) {
  const keys = {
    invalidSelection: 'apply.errors.invalidSelection',
    selectionExpired: 'apply.errors.selectionExpired',
    unsupportedPlatform: 'apply.errors.unsupportedPlatform',
    operationBusy: 'apply.errors.operationBusy',
    destinationOccupied: 'apply.errors.destinationOccupied',
    sourceMissing: 'apply.errors.sourceMissing',
    parentsMissing: 'apply.errors.parentsMissing',
    stateChanged: 'apply.errors.stateChanged',
    recoveryRequired: 'apply.errors.recoveryRequired',
    journalUnavailable: 'apply.errors.journalUnavailable',
    journalInvalid: 'apply.errors.journalInvalid',
    journalChanged: 'apply.errors.journalInvalid',
    journalWriteUncertain: 'apply.errors.journalWriteUncertain',
    creationUncertain: 'apply.errors.creationUncertain',
    notReady: 'apply.errors.notReady'
  }
  return keys[status] ?? 'apply.errors.unavailable'
}

async function prepareSelectedConnectionApply() {
  if (!selectedPreview.value || applyBusy.value) return
  applyError.value = { key: '', recovery: null }
  applyBusy.value = true
  try {
    const result = await window.yonder.prepareConnectionApply(
      storageId.value,
      selectedPreview.value.connection.id
    )
    if (result.status === 'ready') {
      applyPreparation.value = result
      return
    }
    applyError.value = {
      key: connectionApplyErrorKey(result.status),
      recovery: result.recovery ?? null
    }
  } catch {
    applyError.value = { key: 'apply.errors.unavailable', recovery: null }
  } finally {
    applyBusy.value = false
  }
}

async function confirmSelectedConnectionApply() {
  if (!applyPreparation.value || applyBusy.value) return
  const token = applyPreparation.value.token
  applyError.value = { key: '', recovery: null }
  applyBusy.value = true
  try {
    const result = await window.yonder.confirmConnectionApply(token)
    applyPreparation.value = null
    if (result.status === 'connected') {
      if (result.storageId && result.storage) {
        storageId.value = result.storageId
        storage.value = result.storage
        dashboardNoticeKey.value = 'apply.connected'
      } else {
        dashboardNoticeKey.value = 'apply.connectedRefreshFailed'
      }
      selectedPreview.value = null
      view.value = 'dashboard'
      return
    }
    applyError.value = {
      key: connectionApplyErrorKey(result.status),
      recovery: result.recovery ?? null
    }
  } catch {
    applyPreparation.value = null
    applyError.value = { key: 'apply.errors.unavailable', recovery: null }
  } finally {
    applyBusy.value = false
  }
}

async function closeConnectionPreview() {
  if (applyBusy.value) return
  if (applyPreparation.value?.token) {
    applyBusy.value = true
    try {
      const result = await window.yonder.cancelConnectionApply(applyPreparation.value.token)
      if (!['cancelled', 'selectionExpired'].includes(result.status)) {
        applyError.value = { key: connectionApplyErrorKey(result.status), recovery: null }
        return
      }
    } catch {
      applyError.value = { key: 'apply.errors.unavailable', recovery: null }
      return
    } finally {
      applyBusy.value = false
    }
  }
  selectedPreview.value = null
  applyPreparation.value = null
  applyError.value = { key: '', recovery: null }
  view.value = 'dashboard'
}

function connectionDisconnectErrorKey(status) {
  const keys = {
    invalidSelection: 'disconnect.errors.invalidSelection',
    selectionExpired: 'disconnect.errors.selectionExpired',
    unsupportedPlatform: 'disconnect.errors.unsupportedPlatform',
    operationBusy: 'disconnect.errors.operationBusy',
    notConnected: 'disconnect.errors.notConnected',
    linkMismatch: 'disconnect.errors.linkMismatch',
    targetMissing: 'disconnect.errors.stateChanged',
    targetMismatch: 'disconnect.errors.stateChanged',
    stateChanged: 'disconnect.errors.stateChanged',
    removalUncertain: 'disconnect.errors.removalUncertain',
    notReady: 'disconnect.errors.notReady'
  }
  return keys[status] ?? 'disconnect.errors.unavailable'
}

function showConnectionDisconnect(connection) {
  selectedDisconnect.value = connection
  disconnectPreparation.value = null
  disconnectErrorKey.value = ''
  view.value = 'disconnect'
}

async function prepareSelectedConnectionDisconnect() {
  if (!selectedDisconnect.value || disconnectBusy.value) return
  disconnectErrorKey.value = ''
  disconnectBusy.value = true
  try {
    const result = await window.yonder.prepareConnectionDisconnect(
      storageId.value,
      selectedDisconnect.value.id
    )
    if (result.status === 'ready') {
      disconnectPreparation.value = result
      return
    }
    disconnectErrorKey.value = connectionDisconnectErrorKey(result.status)
  } catch {
    disconnectErrorKey.value = 'disconnect.errors.unavailable'
  } finally {
    disconnectBusy.value = false
  }
}

async function confirmSelectedConnectionDisconnect() {
  if (!disconnectPreparation.value || disconnectBusy.value) return
  const token = disconnectPreparation.value.token
  disconnectErrorKey.value = ''
  disconnectBusy.value = true
  try {
    const result = await window.yonder.confirmConnectionDisconnect(token)
    disconnectPreparation.value = null
    if (result.status === 'disconnected') {
      if (result.storageId && result.storage) {
        storageId.value = result.storageId
        storage.value = result.storage
        dashboardNoticeKey.value = 'disconnect.disconnected'
      } else {
        dashboardNoticeKey.value = 'disconnect.disconnectedRefreshFailed'
      }
      selectedDisconnect.value = null
      view.value = 'dashboard'
      return
    }
    disconnectErrorKey.value = connectionDisconnectErrorKey(result.status)
  } catch {
    disconnectPreparation.value = null
    disconnectErrorKey.value = 'disconnect.errors.unavailable'
  } finally {
    disconnectBusy.value = false
  }
}

async function closeConnectionDisconnect() {
  if (disconnectBusy.value) return
  if (disconnectPreparation.value?.token) {
    disconnectBusy.value = true
    try {
      const result = await window.yonder.cancelConnectionDisconnect(
        disconnectPreparation.value.token
      )
      if (!['cancelled', 'selectionExpired', 'invalidSelection'].includes(result.status)) {
        disconnectErrorKey.value = connectionDisconnectErrorKey(result.status)
        return
      }
    } catch {
      disconnectErrorKey.value = 'disconnect.errors.unavailable'
      return
    } finally {
      disconnectBusy.value = false
    }
  }
  selectedDisconnect.value = null
  disconnectPreparation.value = null
  disconnectErrorKey.value = ''
  view.value = 'dashboard'
}

function connectionRemovalErrorKey(status) {
  const keys = {
    invalidSelection: 'removal.errors.invalidSelection',
    selectionExpired: 'removal.errors.selectionExpired',
    unsupportedPlatform: 'removal.errors.unsupportedPlatform',
    operationBusy: 'removal.errors.operationBusy',
    notDisconnected: 'removal.errors.notDisconnected',
    multipleTargets: 'removal.errors.multipleTargets',
    stateChanged: 'removal.errors.stateChanged',
    writeFailed: 'removal.errors.writeFailed',
    writeUncertain: 'removal.errors.writeUncertain',
    notReady: 'removal.errors.notReady'
  }
  return keys[status] ?? 'removal.errors.unavailable'
}

function showConnectionRemoval(connection) {
  selectedRemoval.value = connection
  removalPreparation.value = null
  removalErrorKey.value = ''
  view.value = 'removal'
}

async function prepareSelectedConnectionRemoval() {
  if (!selectedRemoval.value || removalBusy.value) return
  removalErrorKey.value = ''
  removalBusy.value = true
  try {
    const result = await window.yonder.prepareConnectionRemoval(
      storageId.value,
      selectedRemoval.value.id
    )
    if (result.status === 'ready') {
      removalPreparation.value = result
      return
    }
    removalErrorKey.value = connectionRemovalErrorKey(result.status)
  } catch {
    removalErrorKey.value = 'removal.errors.unavailable'
  } finally {
    removalBusy.value = false
  }
}

async function confirmSelectedConnectionRemoval() {
  if (!removalPreparation.value || removalBusy.value) return
  const token = removalPreparation.value.token
  removalErrorKey.value = ''
  removalBusy.value = true
  try {
    const result = await window.yonder.confirmConnectionRemoval(token)
    removalPreparation.value = null
    if (result.status === 'removed') {
      if (result.storageId && result.storage) {
        storageId.value = result.storageId
        storage.value = result.storage
        dashboardNoticeKey.value = 'removal.removed'
      } else {
        dashboardNoticeKey.value = 'removal.removedRefreshFailed'
      }
      selectedRemoval.value = null
      view.value = 'dashboard'
      return
    }
    removalErrorKey.value = connectionRemovalErrorKey(result.status)
  } catch {
    removalPreparation.value = null
    removalErrorKey.value = 'removal.errors.unavailable'
  } finally {
    removalBusy.value = false
  }
}

async function closeConnectionRemoval() {
  if (removalBusy.value) return
  if (removalPreparation.value?.token) {
    removalBusy.value = true
    try {
      const result = await window.yonder.cancelConnectionRemoval(removalPreparation.value.token)
      if (!['cancelled', 'selectionExpired', 'invalidSelection'].includes(result.status)) {
        removalErrorKey.value = connectionRemovalErrorKey(result.status)
        return
      }
    } catch {
      removalErrorKey.value = 'removal.errors.unavailable'
      return
    } finally {
      removalBusy.value = false
    }
  }
  selectedRemoval.value = null
  removalPreparation.value = null
  removalErrorKey.value = ''
  view.value = 'dashboard'
}

async function recheckStorage() {
  inspectionError.value = { key: '', path: '', previousResults: false }
  dashboardNoticeKey.value = ''
  checking.value = true

  try {
    const result = await window.yonder.recheckStorage(storageId.value)
    if (result.status === 'opened') {
      storage.value = result.storage
      return
    }
    inspectionError.value = {
      key: inspectionErrorKey(result.status),
      path: result.configPath ?? result.folderPath ?? storage.value?.configPath ?? '',
      previousResults: true
    }
  } catch {
    inspectionError.value = {
      key: 'inspection.errors.unavailable',
      path: storage.value?.configPath ?? '',
      previousResults: true
    }
  } finally {
    checking.value = false
  }
}

async function chooseFolderForCreation() {
  const startedFromWelcome = view.value === 'welcome'
  noticeKey.value = ''
  inspectionError.value = { key: '', path: '', previousResults: false }
  creationErrorKey.value = ''
  busy.value = true

  try {
    const result = await window.yonder.chooseStorageFolderForCreation(i18next.resolvedLanguage)
    if (result.status === 'cancelled') return
    if (result.status === 'ready' || result.status === 'configExists') {
      openAfterCreation.value = false
      creationOpenErrorKey.value = ''
      creation.value = {
        selectionId: result.selectionId ?? '',
        folderPath: result.folderPath,
        configPath: result.configPath,
        name: result.defaultName
      }
      view.value = 'creation'
      if (result.status === 'configExists') creationErrorKey.value = 'creation.alreadyExists'
      return
    }
    if (startedFromWelcome) noticeKey.value = 'creation.unavailable'
    else creationErrorKey.value = 'creation.unavailable'
  } catch {
    if (startedFromWelcome) noticeKey.value = 'creation.unavailable'
    else creationErrorKey.value = 'creation.unavailable'
  } finally {
    busy.value = false
  }
}

async function confirmCreation() {
  creationErrorKey.value = ''
  creationOpenErrorKey.value = ''
  if (!nameIsValid.value) {
    creationErrorKey.value = 'creation.invalidName'
    return
  }

  busy.value = true
  try {
    const result = await window.yonder.createStorageConfig(
      creation.value.selectionId,
      creation.value.name,
      openAfterCreation.value
    )
    if (result.status === 'created') {
      creation.value = { ...creation.value, ...result, selectionId: '' }
      if (openAfterCreation.value && result.storageId && result.storage) {
        storageId.value = result.storageId
        storage.value = result.storage
        view.value = 'dashboard'
        return
      }
      if (openAfterCreation.value && result.openingFailed) {
        creationOpenErrorKey.value = 'creation.autoOpenFailed'
      }
      view.value = 'created'
      return
    }

    const errorKeys = {
      invalidName: 'creation.invalidName',
      invalidSelection: 'creation.invalidSelection',
      configExists: 'creation.alreadyExists'
    }
    creationErrorKey.value = errorKeys[result.status] ?? 'creation.unavailable'
    if (result.status !== 'invalidName') creation.value.selectionId = ''
  } catch {
    creationErrorKey.value = 'creation.unavailable'
    creation.value.selectionId = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="app-shell" aria-label="Yonder">
    <header class="topbar">
      <span class="tagline">{{ $t('shell.tagline') }}</span>
      <h1><img :src="brandLockupUrl" alt="Yonder" /></h1>
    </header>

    <section v-if="view === 'welcome'" class="welcome" aria-labelledby="welcome-title">
      <span class="storage-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="img">
          <path d="M3.75 6.75h6l2 2h8.5v8.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2z" />
          <path d="M3.75 8.75v-2a2 2 0 0 1 2-2h3.3l2 2h7.2a2 2 0 0 1 2 2" />
        </svg>
      </span>
      <h2 id="welcome-title">{{ $t('shell.title') }}</h2>
      <p class="intro">{{ $t('shell.intro') }}</p>

      <div class="storage-actions">
        <button
          type="button"
          class="primary-action"
          aria-describedby="storage-hint"
          :disabled="busy"
          @click="openStorage"
        >
          {{ busy ? $t('inspection.opening') : $t('shell.open') }}
        </button>
        <button
          type="button"
          class="secondary-action"
          aria-describedby="storage-hint"
          :disabled="busy"
          @click="chooseFolderForCreation"
        >
          {{ busy ? $t('creation.selecting') : $t('shell.create') }}
        </button>
      </div>

      <p id="storage-hint" class="hint">{{ $t('shell.hint') }}</p>
      <p
        class="notice"
        :class="{ 'notice-error': inspectionError.key }"
        role="status"
        aria-live="polite"
      >
        <template v-if="inspectionError.key">
          {{ $t(inspectionError.key) }}
          <code v-if="inspectionError.path">{{ inspectionError.path }}</code>
        </template>
        <template v-else>{{ noticeKey ? $t(noticeKey) : '' }}</template>
      </p>
    </section>

    <section v-else-if="view === 'creation'" class="creation-flow" aria-labelledby="creation-title">
      <h2 id="creation-title">{{ $t('creation.title') }}</h2>
      <p class="intro">{{ $t('creation.intro') }}</p>

      <dl class="creation-preview">
        <div>
          <dt>{{ $t('creation.folder') }}</dt>
          <dd>
            <code>{{ creation.folderPath }}</code>
          </dd>
        </div>
        <div>
          <dt>{{ $t('creation.configFile') }}</dt>
          <dd>
            <code>{{ creation.configPath }}</code>
          </dd>
        </div>
      </dl>

      <form @submit.prevent="confirmCreation">
        <label for="storage-name">{{ $t('creation.name') }}</label>
        <input
          id="storage-name"
          v-model="creation.name"
          type="text"
          maxlength="240"
          :disabled="busy || !creation.selectionId"
          :aria-describedby="
            creationErrorKey || !nameIsValid ? 'creation-error' : 'creation-effect'
          "
        />
        <p v-if="!creationErrorKey && nameIsValid" id="creation-effect" class="creation-effect">
          {{ $t('creation.effect') }}
        </p>
        <p
          v-if="creationErrorKey || !nameIsValid"
          id="creation-error"
          class="flow-error"
          role="alert"
        >
          {{ $t(creationErrorKey || 'creation.invalidName') }}
        </p>

        <label class="creation-option">
          <input
            v-model="openAfterCreation"
            type="checkbox"
            :disabled="busy || !creation.selectionId"
          />
          <span>{{ $t('creation.openAfterCreation') }}</span>
        </label>

        <div class="flow-actions">
          <button
            v-if="creation.selectionId"
            type="submit"
            class="primary-action"
            :disabled="busy || !nameIsValid"
          >
            {{ busy ? $t('creation.creating') : $t('creation.confirm') }}
          </button>
          <button
            v-else
            type="button"
            class="primary-action"
            :disabled="busy"
            @click="chooseFolderForCreation"
          >
            {{ busy ? $t('creation.selecting') : $t('creation.chooseDifferent') }}
          </button>
          <button type="button" class="secondary-action" :disabled="busy" @click="showWelcome">
            {{ $t('creation.back') }}
          </button>
        </div>
      </form>
    </section>

    <section v-else-if="view === 'created'" class="created-state" aria-labelledby="created-title">
      <span class="success-mark" aria-hidden="true">✓</span>
      <h2 id="created-title">{{ $t('creation.createdTitle') }}</h2>
      <p class="intro">{{ $t('creation.createdIntro') }}</p>
      <p class="created-path">
        <code>{{ creation.configPath }}</code>
      </p>
      <p class="creation-effect">{{ $t('creation.createdEffect') }}</p>
      <p v-if="creationOpenErrorKey" class="flow-error" role="status">
        {{ $t(creationOpenErrorKey) }}
      </p>
      <button type="button" class="secondary-action" @click="showWelcome">
        {{ $t('creation.done') }}
      </button>
    </section>

    <section
      v-else-if="view === 'connection-draft'"
      class="connection-draft-flow"
      aria-labelledby="connection-draft-title"
    >
      <h2 id="connection-draft-title">{{ $t('connectionDraft.title') }}</h2>
      <p class="intro">{{ $t('connectionDraft.intro') }}</p>
      <p class="connection-type-explanation">{{ $t('connectionDraft.typeRule') }}</p>

      <form @submit.prevent="previewConnectionDraft">
        <label for="connection-name">{{ $t('connectionDraft.name') }}</label>
        <input
          id="connection-name"
          v-model="connectionDraft.name"
          type="text"
          maxlength="240"
          :disabled="connectionDraftBusy"
          @input="updateConnectionDraftName"
        />

        <label for="connection-id">{{ $t('connectionDraft.id') }}</label>
        <input
          id="connection-id"
          v-model="connectionDraft.id"
          type="text"
          maxlength="64"
          spellcheck="false"
          :disabled="connectionDraftBusy"
          @input="editConnectionDraftId"
        />
        <p class="field-hint">{{ $t('connectionDraft.idHint') }}</p>

        <div class="draft-picker">
          <div>
            <span>{{ $t('connectionDraft.source') }}</span>
            <strong>{{
              connectionDraft.sourceRelativePath || $t('connectionDraft.notSelected')
            }}</strong>
            <code v-if="connectionDraft.sourceDisplayPath">
              {{ connectionDraft.sourceDisplayPath }}
            </code>
            <span v-if="connectionDraft.sourceType" class="connection-type-badge">
              {{ $t(`connectionTypes.${connectionDraft.sourceType}`) }}
            </span>
          </div>
          <button
            type="button"
            class="secondary-action"
            :disabled="connectionDraftBusy"
            @click="chooseConnectionDraftSource"
          >
            {{ $t('connectionDraft.chooseSource') }}
          </button>
        </div>

        <div class="draft-picker">
          <div>
            <span>{{ $t('connectionDraft.targetParent') }}</span>
            <strong>{{
              connectionDraft.targetRelativePath || $t('connectionDraft.notSelected')
            }}</strong>
            <code v-if="connectionDraft.targetDisplayPath">
              {{ connectionDraft.targetDisplayPath }}
            </code>
          </div>
          <button
            type="button"
            class="secondary-action"
            :disabled="connectionDraftBusy"
            @click="chooseConnectionDraftTargetParent"
          >
            {{ $t('connectionDraft.chooseTargetParent') }}
          </button>
        </div>

        <label for="connection-link-name">{{ $t('connectionDraft.linkName') }}</label>
        <input
          id="connection-link-name"
          v-model="connectionDraft.linkName"
          type="text"
          maxlength="255"
          :disabled="connectionDraftBusy"
          @input="editConnectionDraftLinkName"
        />
        <p v-if="connectionDraft.targetRelativePath && connectionDraft.linkName" class="field-hint">
          {{ $t('connectionDraft.resultingTarget') }}
          <code>{{ connectionDraft.targetRelativePath }}/{{ connectionDraft.linkName }}</code>
        </p>

        <p v-if="connectionDraftErrorKey" class="flow-error" role="alert">
          {{ $t(connectionDraftErrorKey) }}
        </p>
        <p class="draft-read-only-note">{{ $t('connectionDraft.readOnlyNote') }}</p>

        <div class="flow-actions">
          <button
            type="submit"
            class="primary-action"
            :disabled="connectionDraftBusy || !connectionDraftIsValid"
          >
            {{
              connectionDraftBusy ? $t('connectionDraft.checking') : $t('connectionDraft.review')
            }}
          </button>
          <button
            type="button"
            class="secondary-action"
            :disabled="connectionDraftBusy"
            @click="closeConnectionDraft"
          >
            {{ $t('connectionDraft.back') }}
          </button>
        </div>
      </form>
    </section>

    <section
      v-else-if="view === 'connection-draft-preview'"
      class="connection-draft-preview"
      aria-labelledby="connection-draft-preview-title"
    >
      <h2 id="connection-draft-preview-title">{{ $t('connectionDraft.previewTitle') }}</h2>
      <p class="intro">{{ $t('connectionDraft.previewIntro') }}</p>

      <dl class="draft-preview-paths">
        <div>
          <dt>{{ $t('connectionDraft.type') }}</dt>
          <dd>
            <strong>{{ $t(`connectionTypes.${connectionDraftPreview.sourceType}`) }}</strong>
          </dd>
        </div>
        <div>
          <dt>{{ $t('connectionDraft.configFile') }}</dt>
          <dd>
            <code>{{ connectionDraftPreview.configPath }}</code>
          </dd>
        </div>
        <div>
          <dt>{{ $t('connectionDraft.source') }}</dt>
          <dd>
            <code>{{ connectionDraftPreview.sourcePath }}</code>
          </dd>
        </div>
        <div>
          <dt>{{ $t('connectionDraft.destination') }}</dt>
          <dd>
            <code>{{ connectionDraftPreview.targetPath }}</code>
          </dd>
        </div>
      </dl>

      <div class="draft-yaml-preview">
        <span>{{ $t('connectionDraft.yamlEntry') }}</span>
        <pre><code>{{ connectionDraftPreview.yaml }}</code></pre>
      </div>
      <p class="preview-effect">{{ $t('connectionDraft.previewEffect') }}</p>
      <p class="preview-unchanged">{{ $t('connectionDraft.previewUnchanged') }}</p>
      <p class="preview-note">{{ $t('connectionDraft.previewNote') }}</p>

      <p v-if="connectionDraftWriteErrorKey" class="flow-error" role="alert">
        {{ $t(connectionDraftWriteErrorKey) }}
      </p>

      <div v-if="connectionDraftPreparation" class="draft-write-confirmation">
        <h3>{{ $t('connectionDraft.confirmTitle') }}</h3>
        <p>{{ $t('connectionDraft.confirmEffect') }}</p>
        <code>{{ connectionDraftPreparation.configPath }}</code>
        <p>{{ $t('connectionDraft.confirmUnchanged') }}</p>
      </div>

      <div v-if="connectionDraftPreparation" class="flow-actions">
        <button
          type="button"
          class="primary-action"
          :disabled="connectionDraftBusy"
          @click="confirmConnectionDraftWrite"
        >
          {{
            connectionDraftBusy ? $t('connectionDraft.writing') : $t('connectionDraft.confirmWrite')
          }}
        </button>
        <button
          type="button"
          class="secondary-action"
          :disabled="connectionDraftBusy"
          @click="cancelConnectionDraftPreparation"
        >
          {{ $t('connectionDraft.cancelWrite') }}
        </button>
      </div>

      <template v-else>
        <button
          type="button"
          class="primary-action draft-prepare-action"
          :disabled="connectionDraftBusy"
          @click="prepareConnectionDraftWrite"
        >
          {{
            connectionDraftBusy
              ? $t('connectionDraft.preparingWrite')
              : $t('connectionDraft.prepareWrite')
          }}
        </button>
        <div class="flow-actions">
          <button
            type="button"
            class="secondary-action"
            :disabled="connectionDraftBusy"
            @click="editConnectionDraft"
          >
            {{ $t('connectionDraft.edit') }}
          </button>
          <button
            type="button"
            class="secondary-action"
            :disabled="connectionDraftBusy"
            @click="closeConnectionDraft"
          >
            {{ $t('connectionDraft.back') }}
          </button>
        </div>
      </template>
    </section>

    <section v-else-if="view === 'dashboard'" class="dashboard" aria-labelledby="storage-title">
      <div class="dashboard-heading">
        <div class="storage-heading">
          <h2 id="storage-title">{{ storage.name }}</h2>
          <code>{{ storage.folderPath }}</code>
        </div>
        <div class="dashboard-actions">
          <button
            type="button"
            class="primary-action"
            :disabled="checking || busy"
            @click="recheckStorage"
          >
            {{ checking ? $t('inspection.checking') : $t('inspection.checkAgain') }}
          </button>
          <button
            type="button"
            class="secondary-action"
            :disabled="checking || busy"
            @click="openStorage"
          >
            {{ busy ? $t('inspection.opening') : $t('inspection.openAnother') }}
          </button>
        </div>
      </div>

      <p v-if="inspectionError.key" class="dashboard-error" role="status">
        {{ $t(inspectionError.key) }}
        <span v-if="inspectionError.previousResults">{{ $t('inspection.previousResults') }}</span>
        <code v-if="inspectionError.path">{{ inspectionError.path }}</code>
      </p>
      <p v-if="dashboardNoticeKey" class="dashboard-notice" role="status">
        {{ $t(dashboardNoticeKey) }}
      </p>

      <div class="inspection-summary" aria-live="polite">
        <span>{{ $t('inspection.connections') }}: {{ storage.connections.length }}</span>
        <span>{{ $t('inspection.connected') }}: {{ connectedCount }}</span>
        <span>{{ $t('inspection.needsAttention') }}: {{ attentionCount }}</span>
      </div>

      <div v-if="storage.connections.length === 0" class="empty-connections">
        <h3>{{ $t('inspection.emptyTitle') }}</h3>
        <p>{{ $t('inspection.emptyText') }}</p>
        <button type="button" class="primary-action" @click="showConnectionDraft">
          {{ $t('connectionDraft.open') }}
        </button>
      </div>

      <div v-else class="connection-list">
        <div class="connection-list-actions">
          <button type="button" class="secondary-action" @click="showConnectionDraft">
            {{ $t('connectionDraft.open') }}
          </button>
        </div>
        <article
          v-for="connection in storage.connections"
          :key="connection.id"
          class="connection-card"
          :class="`state-${connection.state}`"
        >
          <header>
            <h3>{{ connection.name }}</h3>
            <span class="state-badge">{{ $t(`inspection.states.${connection.state}`) }}</span>
          </header>
          <dl>
            <div v-if="connection.sourceType !== 'unknown'">
              <dt>{{ $t('inspection.type') }}</dt>
              <dd>
                <strong>{{ $t(`connectionTypes.${connection.sourceType}`) }}</strong>
              </dd>
            </div>
            <div>
              <dt>{{ $t('inspection.source') }}</dt>
              <dd>
                <code>{{ connection.sourcePath }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ $t('inspection.target') }}</dt>
              <dd>
                <code v-if="connection.targetPath">{{ connection.targetPath }}</code>
                <span v-else>{{ $t('inspection.notConfiguredPath') }}</span>
              </dd>
            </div>
          </dl>
          <div
            v-if="connection.state === 'connected'"
            class="connection-preview-line connection-complete-line"
          >
            <p>
              <strong>{{ $t('inspection.connectedReady') }}</strong>
            </p>
            <button
              type="button"
              class="secondary-action"
              @click="showConnectionDisconnect(connection)"
            >
              {{ $t('disconnect.open') }}
            </button>
          </div>
          <div v-else-if="connectionPreview(connection)" class="connection-preview-line">
            <p>
              <strong v-if="connectionPreview(connection).status !== 'ready'">
                {{ $t('preview.actionNeeded') }}
              </strong>
              {{
                $t(
                  `preview.reasons.${
                    connectionPreview(connection).status === 'ready'
                      ? 'ready'
                      : connectionPreview(connection).reason
                  }`
                )
              }}
            </p>
            <button
              v-if="connectionPreview(connection).status === 'ready'"
              type="button"
              class="primary-action"
              @click="showConnectionPreview(connection)"
            >
              {{ $t('preview.open') }}
            </button>
          </div>
          <div
            v-if="connection.state === 'targetMissing' && connection.readiness?.status === 'ready'"
            class="connection-preview-line connection-secondary-line"
          >
            <p>
              {{ $t('removal.available') }}
            </p>
            <button
              type="button"
              class="secondary-action"
              @click="showConnectionRemoval(connection)"
            >
              {{ $t('removal.open') }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <section
      v-else-if="view === 'removal'"
      class="connection-preview"
      aria-labelledby="removal-title"
    >
      <h2 id="removal-title">{{ $t('removal.title') }}</h2>
      <p class="intro">{{ $t('removal.intro', { name: selectedRemoval.name }) }}</p>

      <div class="preview-panel">
        <span>{{ $t('preview.proposedOperation') }}</span>
        <strong>{{ $t('removal.operation') }}</strong>
        <dl>
          <div>
            <dt>{{ $t('preview.source') }}</dt>
            <dd>
              <code>{{ selectedRemoval.sourcePath }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ $t('preview.destination') }}</dt>
            <dd>
              <code>{{ selectedRemoval.targetPath }}</code>
            </dd>
          </div>
        </dl>
      </div>

      <p class="preview-effect">{{ $t('removal.effect') }}</p>
      <p class="preview-unchanged">{{ $t('removal.unchanged') }}</p>
      <p class="preview-note">{{ $t('removal.note') }}</p>

      <div v-if="removalPreparation" class="apply-confirmation" role="status">
        <strong>{{ $t('removal.readyTitle') }}</strong>
        <p>{{ $t('removal.readyText') }}</p>
        <small
          >{{ $t('removal.checkedAt') }} <code>{{ removalPreparation.checkedAt }}</code></small
        >
      </div>

      <p v-if="removalErrorKey" class="flow-error apply-error" role="alert">
        {{ $t(removalErrorKey) }}
      </p>

      <div class="flow-actions preview-actions">
        <button
          v-if="!removalPreparation && !removalErrorKey"
          type="button"
          class="primary-action"
          :disabled="removalBusy"
          @click="prepareSelectedConnectionRemoval"
        >
          {{ removalBusy ? $t('removal.preparing') : $t('removal.prepare') }}
        </button>
        <button
          v-if="removalPreparation"
          type="button"
          class="danger-action"
          :disabled="removalBusy"
          @click="confirmSelectedConnectionRemoval"
        >
          {{ removalBusy ? $t('removal.removing') : $t('removal.confirm') }}
        </button>
        <button
          type="button"
          class="secondary-action"
          :disabled="removalBusy"
          @click="closeConnectionRemoval"
        >
          {{ removalPreparation ? $t('removal.cancel') : $t('removal.back') }}
        </button>
      </div>
    </section>

    <section
      v-else-if="view === 'disconnect'"
      class="connection-preview"
      aria-labelledby="disconnect-title"
    >
      <h2 id="disconnect-title">{{ $t('disconnect.title') }}</h2>
      <p class="intro">{{ $t('disconnect.intro', { name: selectedDisconnect.name }) }}</p>

      <div class="preview-panel">
        <span>{{ $t('preview.proposedOperation') }}</span>
        <strong>{{ $t('disconnect.operation') }}</strong>
        <dl>
          <div>
            <dt>{{ $t('preview.source') }}</dt>
            <dd>
              <code>{{ selectedDisconnect.sourcePath }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ $t('preview.destination') }}</dt>
            <dd>
              <code>{{ selectedDisconnect.targetPath }}</code>
            </dd>
          </div>
        </dl>
      </div>

      <p class="preview-effect">{{ $t('disconnect.effect') }}</p>
      <p class="preview-unchanged">{{ $t('disconnect.unchanged') }}</p>
      <p class="preview-note">{{ $t('disconnect.note') }}</p>

      <div v-if="disconnectPreparation" class="apply-confirmation" role="status">
        <strong>{{ $t('disconnect.readyTitle') }}</strong>
        <p>{{ $t('disconnect.readyText') }}</p>
        <small
          >{{ $t('disconnect.checkedAt') }}
          <code>{{ disconnectPreparation.checkedAt }}</code></small
        >
      </div>

      <p v-if="disconnectErrorKey" class="flow-error apply-error" role="alert">
        {{ $t(disconnectErrorKey) }}
      </p>

      <div class="flow-actions preview-actions">
        <button
          v-if="!disconnectPreparation && !disconnectErrorKey"
          type="button"
          class="primary-action"
          :disabled="disconnectBusy"
          @click="prepareSelectedConnectionDisconnect"
        >
          {{ disconnectBusy ? $t('disconnect.preparing') : $t('disconnect.prepare') }}
        </button>
        <button
          v-if="disconnectPreparation"
          type="button"
          class="danger-action"
          :disabled="disconnectBusy"
          @click="confirmSelectedConnectionDisconnect"
        >
          {{ disconnectBusy ? $t('disconnect.disconnecting') : $t('disconnect.confirm') }}
        </button>
        <button
          type="button"
          class="secondary-action"
          :disabled="disconnectBusy"
          @click="closeConnectionDisconnect"
        >
          {{ disconnectPreparation ? $t('disconnect.cancel') : $t('disconnect.back') }}
        </button>
      </div>
    </section>

    <section v-else class="connection-preview" aria-labelledby="preview-title">
      <h2 id="preview-title">{{ $t('preview.title') }}</h2>
      <p class="intro">{{ $t('preview.intro', { name: selectedPreview.connection.name }) }}</p>

      <div class="preview-panel">
        <span>{{ $t('preview.proposedOperation') }}</span>
        <strong>{{ $t(`preview.operations.${selectedPreview.preview.operation}`) }}</strong>
        <dl>
          <div>
            <dt>{{ $t('preview.type') }}</dt>
            <dd>
              <strong>
                {{ $t(`connectionTypes.${selectedPreview.connection.sourceType}`) }}
              </strong>
            </dd>
          </div>
          <div>
            <dt>{{ $t('preview.source') }}</dt>
            <dd>
              <code>{{ selectedPreview.connection.sourcePath }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ $t('preview.destination') }}</dt>
            <dd>
              <code>{{ selectedPreview.connection.targetPath }}</code>
            </dd>
          </div>
        </dl>
      </div>

      <p class="preview-effect">{{ $t('preview.effect') }}</p>
      <p class="preview-unchanged">{{ $t('preview.unchanged') }}</p>
      <p class="preview-note">{{ $t('preview.note') }}</p>

      <div v-if="applyPreparation" class="apply-confirmation" role="status">
        <strong>{{ $t('apply.readyTitle') }}</strong>
        <p>{{ $t('apply.readyText') }}</p>
        <small
          >{{ $t('apply.checkedAt') }} <code>{{ applyPreparation.checkedAt }}</code></small
        >
      </div>

      <p v-if="applyError.key" class="flow-error apply-error" role="alert">
        {{ $t(applyError.key) }}
      </p>

      <dl v-if="applyError.recovery" class="apply-recovery">
        <div>
          <dt>{{ $t('apply.recoveryObservation') }}</dt>
          <dd>{{ $t(`apply.observations.${applyError.recovery.observation}`) }}</dd>
        </div>
        <div>
          <dt>{{ $t('preview.source') }}</dt>
          <dd>
            <code>{{ applyError.recovery.sourcePath }}</code>
          </dd>
        </div>
        <div>
          <dt>{{ $t('preview.destination') }}</dt>
          <dd>
            <code>{{ applyError.recovery.targetPath }}</code>
          </dd>
        </div>
      </dl>

      <div class="flow-actions preview-actions">
        <button
          v-if="!applyPreparation && !applyError.key"
          type="button"
          class="primary-action"
          :disabled="applyBusy"
          @click="prepareSelectedConnectionApply"
        >
          {{ applyBusy ? $t('apply.preparing') : $t('apply.prepare') }}
        </button>
        <button
          v-if="applyPreparation"
          type="button"
          class="primary-action"
          :disabled="applyBusy"
          @click="confirmSelectedConnectionApply"
        >
          {{ applyBusy ? $t('apply.applying') : $t('apply.confirm') }}
        </button>
        <button
          type="button"
          class="secondary-action"
          :disabled="applyBusy"
          @click="closeConnectionPreview"
        >
          {{ applyPreparation ? $t('apply.cancel') : $t('preview.back') }}
        </button>
      </div>
    </section>

    <footer>
      <div class="language-picker">
        <label for="language">{{ $t('shell.language') }}</label>
        <select
          id="language"
          :value="languagePreference"
          @change="changeLanguagePreference($event.target.value)"
        >
          <option value="system">{{ $t('shell.systemLanguage') }}</option>
          <option value="en" lang="en">English</option>
          <option value="ru" lang="ru">Русский</option>
        </select>
      </div>
      <p v-if="languageSaveFailed" class="language-error" role="status">
        {{ $t('shell.languageSaveFailed') }}
      </p>
      <span>{{ $t('shell.foundation') }}</span>
    </footer>
  </main>
</template>
