import { House, Library, Search, NotebookPen, Bookmark, Highlighter, BookText } from 'lucide-vue-next'

/** Primary navigation, shared by the desktop sidebar and the mobile bottom bar. */
export function useNavItems() {
  const route = useRoute()
  const lastRead = useState<string>('last-read', () => DEFAULT_PATH)
  return computed(() => [
    { label: 'Home', to: lastRead.value, icon: House, active: route.path.startsWith('/read') },
    { label: 'Library', to: '/library', icon: Library, active: route.path === '/library' },
    { label: 'Dictionary', to: '/dictionary', icon: BookText, active: route.path === '/dictionary' },
    { label: 'Search', to: '/search', icon: Search, active: route.path === '/search' },
    { label: 'Notes', to: '/notes', icon: NotebookPen, active: route.path === '/notes' },
    { label: 'Bookmarks', to: '/bookmarks', icon: Bookmark, active: route.path === '/bookmarks' },
    { label: 'Highlights', to: '/highlights', icon: Highlighter, active: route.path === '/highlights' },
  ])
}
