// Loads the user's settings, notes and highlights from user.db before the app mounts, so the reader never opens in
// the default translation and text size and then switches. Reading a local database takes a few milliseconds.
// init() always resolves, on failure or after LOAD_TIMEOUT_MS: app.vue then shows the error and reading still works.
export default defineNuxtPlugin(async () => {
  await useUserData().init()
})
