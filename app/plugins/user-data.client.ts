// Loads the user's settings, notes and highlights from user.db before the app mounts, so the reader never opens in
// the default translation and text size and then switches. Reading a local database takes a few milliseconds.
// init() resolves even when user.db cannot be read: app.vue then shows the error and reading still works.
export default defineNuxtPlugin(async () => {
  await useUserData().init()
})
