import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'coverage/**', 'tmp/**'] },
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs}', '**/*.vue'],
    languageOptions: { globals: globals.node },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/attributes-order': 'off'
    }
  },
  {
    files: ['src/renderer/**/*.{js,vue}'],
    languageOptions: { globals: globals.browser }
  }
]
