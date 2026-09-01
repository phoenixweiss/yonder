<script setup>
import { computed, ref } from 'vue'
import { isValidStorageName } from '../../shared/config.js'
import i18next, {
  changeLanguagePreference,
  languagePreference,
  languageSaveFailed
} from './i18n.js'

const view = ref('welcome')
const noticeKey = ref('')
const creationErrorKey = ref('')
const busy = ref(false)
const creation = ref({
  selectionId: '',
  folderPath: '',
  configPath: '',
  name: ''
})

const nameIsValid = computed(() => isValidStorageName(creation.value.name))

function showWelcome() {
  view.value = 'welcome'
  creationErrorKey.value = ''
  creation.value = { selectionId: '', folderPath: '', configPath: '', name: '' }
}

async function chooseFolderForCreation() {
  const startedFromWelcome = view.value === 'welcome'
  noticeKey.value = ''
  creationErrorKey.value = ''
  busy.value = true

  try {
    const result = await window.yonder.chooseStorageFolderForCreation(i18next.resolvedLanguage)
    if (result.status === 'cancelled') return
    if (result.status === 'ready' || result.status === 'configExists') {
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
  if (!nameIsValid.value) {
    creationErrorKey.value = 'creation.invalidName'
    return
  }

  busy.value = true
  try {
    const result = await window.yonder.createStorageConfig(
      creation.value.selectionId,
      creation.value.name
    )
    if (result.status === 'created') {
      creation.value = { ...creation.value, ...result, selectionId: '' }
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
          @click="noticeKey = 'shell.openNotice'"
        >
          {{ $t('shell.open') }}
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
      <p class="notice" role="status" aria-live="polite">
        {{ noticeKey ? $t(noticeKey) : '' }}
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

    <section v-else class="created-state" aria-labelledby="created-title">
      <span class="success-mark" aria-hidden="true">✓</span>
      <h2 id="created-title">{{ $t('creation.createdTitle') }}</h2>
      <p class="intro">{{ $t('creation.createdIntro') }}</p>
      <p class="created-path">
        <code>{{ creation.configPath }}</code>
      </p>
      <p class="creation-effect">{{ $t('creation.createdEffect') }}</p>
      <button type="button" class="secondary-action" @click="showWelcome">
        {{ $t('creation.done') }}
      </button>
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
