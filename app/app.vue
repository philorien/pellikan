<script setup lang="ts">
const route = useRoute()
const { init: initTheme } = useTheme()
const { error: userError } = useUserData()
const { restore, sync } = useTabs()

// Focus the landmark directly. Following "#main" would push a hash onto the route, and the watcher below would treat it as a new tab.
const skipToMain = () => document.getElementById('main')?.focus()

useHead({
  title: 'Pellikan',
  link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }, { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
  script: [{ innerHTML: THEME_BOOT, tagPosition: 'head' }],
})

onMounted(() => {
  initTheme()
  // User data is already loaded (plugins/user-data.client.ts), and the saved tabs are part of it.
  restore(route.fullPath === '/' ? DEFAULT_PATH : route.fullPath)
})

// The route drives the active tab. "/" only redirects, so it never becomes a tab. (No-op until restore() has run.)
watch(() => route.fullPath, (p) => { if (p !== '/') sync(p) })
</script>

<template>
  <div class="flex h-full pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
    <a
      href="#main"
      class="fixed left-2 top-2 z-50 -translate-y-[200%] rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg focus:translate-y-0"
      @click.prevent="skipToMain"
    >Skip to main content</a>
    <NuxtRouteAnnouncer />
    <AppSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar />
      <TabStrip />
      <div v-if="userError" role="alert" class="flex items-start gap-3 border-l-[3px] border-t border-brand border-t-line bg-surface-2 px-4 py-2 text-sm">
        <p class="min-w-0 flex-1">{{ userError }}</p>
        <button type="button" class="shrink-0 rounded px-2 py-0.5 font-medium text-accent hover:underline" @click="userError = null">Dismiss</button>
      </div>
      <main id="main" tabindex="-1" class="min-h-0 flex-1 border-t border-line">
        <NuxtPage />
      </main>
      <BottomNav />
    </div>
    <CommandPalette />
  </div>
</template>
