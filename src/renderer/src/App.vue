<script setup>
import { ref } from 'vue'
import { changeLanguagePreference, languagePreference, languageSaveFailed } from './i18n.js'

const noticeKey = ref('')
</script>

<template>
  <main class="app-shell" aria-label="Yonder">
    <header class="topbar">
      <span class="tagline">{{ $t('shell.tagline') }}</span>
      <h1>Yonder</h1>
    </header>

    <section class="welcome" aria-labelledby="welcome-title">
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
          @click="noticeKey = 'shell.createNotice'"
        >
          {{ $t('shell.create') }}
        </button>
      </div>

      <p id="storage-hint" class="hint">{{ $t('shell.hint') }}</p>
      <p class="notice" role="status" aria-live="polite">
        {{ noticeKey ? $t(noticeKey) : '' }}
      </p>
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
