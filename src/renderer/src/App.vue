<script setup>
import { computed, ref } from 'vue'
import { isValidStorageName } from '../../shared/config.js'
import { buildConnectionPreview } from '../../shared/connection-preview.js'
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
const dashboardNoticeKey = ref('')
const inspectionError = ref({ key: '', path: '', previousResults: false })
const creation = ref({
  selectionId: '',
  folderPath: '',
  configPath: '',
  name: ''
})

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
  dashboardNoticeKey.value = ''
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
      <h1>Yonder</h1>
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
      </div>

      <div v-else class="connection-list">
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
          <div v-if="connectionPreview(connection)" class="connection-preview-line">
            <p>
              <strong>{{ $t('preview.nextStep') }}</strong>
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
              class="secondary-action"
              @click="showConnectionPreview(connection)"
            >
              {{ $t('preview.open') }}
            </button>
          </div>
        </article>
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
