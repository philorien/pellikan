// Flat ESLint config. Style is not enforced here (the codebase is hand-formatted); this catches likely bugs
// and, through vuejs-accessibility, accessibility mistakes (see ACCESSIBILITY.md).
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueA11y from 'eslint-plugin-vuejs-accessibility'

export default tseslint.config(
  { ignores: ['.nuxt/**', '.output/**', 'dist/**', 'node_modules/**', 'src-tauri/**', 'data/build/**', 'data/sources/**', '.agents/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  ...vueA11y.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // Layout rules would reformat the whole codebase.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      // Existing `any`s and accessibility gaps are reported as warnings so they stay visible without blocking CI.
      // The accessibility ones are tracked in ACCESSIBILITY.md and issues #22 to #24.
      '@typescript-eslint/no-explicit-any': 'warn',
      'vuejs-accessibility/no-static-element-interactions': 'warn',
      'vuejs-accessibility/click-events-have-key-events': 'warn',
      'vuejs-accessibility/interactive-supports-focus': 'warn',
      'vuejs-accessibility/form-control-has-label': 'warn',
      // This rule demands both a nested control and a for attribute; either one associates the label.
      'vuejs-accessibility/label-has-for': ['error', { required: { some: ['nesting', 'id'] } }],
      // Search snippets mark highlights with control characters, and the text cleaners match NBSP and friends on purpose.
      'no-control-regex': 'off',
      'no-irregular-whitespace': ['error', { skipStrings: true, skipRegExps: true, skipTemplates: true, skipComments: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // TypeScript already reports undefined names, and Nuxt auto-imports (ref, computed, useState...) are not
    // visible to ESLint.
    files: ['**/*.ts', '**/*.vue'],
    rules: { 'no-undef': 'off' },
  },
  {
    // Nuxt names pages after their route (search.vue, notes.vue), and app.vue is fixed by Nuxt.
    files: ['app/pages/**/*.vue', 'app/app.vue', 'app/components/Panel.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
)
