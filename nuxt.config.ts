import tailwindcss from '@tailwindcss/vite'

// Pellikan is a single-page app: Tauri loads the generated static files, so there is no server rendering.
// In `nuxt dev` (plain browser) the same queries are served by server/api/query/[name].post.ts.
export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()], clearScreen: false },
  devServer: { port: 3000, host: 'localhost' },
  telemetry: false,
  // The node:test files stub Nuxt globals (globalThis.useState = ...). Left in, those assignments become global
  // declarations that replace Nuxt's typed useState, so type checking skips them.
  typescript: { tsConfig: { exclude: ['../app/**/*.test.mjs', '../shared/**/*.test.mjs', '../server/**/*.test.mjs'] } },
  app: {
    head: {
      // WCAG 3.1.1 (Level A): document language for screen readers. UI chrome is
      // English; downloadable translation packs keep their own lang on verse text.
      htmlAttrs: { lang: 'en' },
      title: 'Pellikan',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
    },
  },
})
