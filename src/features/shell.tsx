import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookUser, ListChecks, MessageCircle, Settings, StickyNote } from 'lucide-react'
import { time, useSpace } from '../lib/store'
import { useDocumentVisible, useKeyboardOpen } from '../lib/device'
import { Avatar, Button, IconButton, Splash, cx, toast, toastError } from '../components/ui'
import { ChatTab } from './chat'
import { ContactsTab } from './contacts'
import { ListsTab } from './lists'
import { NotesTab } from './notes'
import { SettingsSheet } from './settings'
import { NavContext, type Nav, type Tab } from './nav'
import { NameScreen, SetUpScreen, UnlockScreen } from './encryption'

const TABS = [
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'contacts', label: 'Contacts', icon: BookUser },
  { id: 'lists', label: 'Lists', icon: ListChecks },
  { id: 'notes', label: 'Notes', icon: StickyNote },
] as const satisfies readonly { id: Tab; label: string; icon: unknown }[]

const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Private mode or storage disabled: these are only conveniences.
    }
  },
}

export function Shell() {
  const { ready, loadError, e2e, decrypting, me } = useSpace()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (ready) return
    const t = setTimeout(() => setSlow(true), 12_000)
    return () => clearTimeout(t)
  }, [ready])

  // Wait for the first decryption after unlocking, but don't flash a loading
  // screen every time a new message arrives and is being decrypted.
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (!e2e.unlocked) setOpened(false)
    else if (!decrypting) setOpened(true)
  }, [e2e.unlocked, decrypting])

  if (ready) {
    if (!e2e.ready) return <Splash />
    if (!e2e.enabled) return <SetUpScreen />
    if (!e2e.unlocked) return <UnlockScreen />
    if (!opened) return <Splash />
    if (!me?.display_name) return <NameScreen />
    return <ShellReady />
  }
  if (!loadError && !slow) return <Splash />
  return (
    <div className="app-height flex flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="font-semibold">{loadError ? "Couldn't load your space" : 'Still connecting…'}</p>
      {loadError && <p className="text-sm text-muted">{loadError}</p>}
      <Button onClick={() => location.reload()}>Try again</Button>
    </div>
  )
}

function ShellReady() {
  const { space, userId, partner, partnerOnline, partnerTyping, messages, legacyRows, actions } = useSpace()
  const [tab, setTabState] = useState<Tab>(() => (storage.get('duo:tab') as Tab | null) ?? 'chat')
  const [focusContactId, setFocusContactId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const visible = useDocumentVisible()
  const keyboardOpen = useKeyboardOpen()

  // Encrypt anything saved before encryption was on, and clear out photos
  // and videos that were opened or expired. Once per visit.
  const upgraded = useRef(false)
  useEffect(() => {
    if (upgraded.current || legacyRows === 0) return
    upgraded.current = true
    actions
      .upgradeLegacy()
      .then((n) => n && toast(`Encrypted ${n} older item${n === 1 ? '' : 's'}`))
      .catch(toastError)
  }, [legacyRows, actions])
  useEffect(() => {
    actions.sweepMedia().catch(() => {})
  }, [actions])

  const nav = useMemo<Nav>(() => {
    const setTab = (t: Tab) => {
      setTabState(t)
      storage.set('duo:tab', t)
    }
    return {
      tab,
      setTab,
      openContact: (id) => {
        setFocusContactId(id)
        setTab('contacts')
      },
      focusContactId,
      clearFocusContact: () => setFocusContactId(null),
    }
  }, [tab, focusContactId])

  // Unread = their messages newer than the last one you saw with Chat open.
  // On a new device, history so far counts as read; everything after doesn't.
  // (Compared against server timestamps only, so a skewed phone clock can't hide messages.)
  const readKey = `duo:lastRead:${space!.id}`
  const [lastRead, setLastRead] = useState(
    () => storage.get(readKey) ?? messages.findLast((m) => !m.pending)?.created_at ?? new Date(0).toISOString(),
  )
  useEffect(() => storage.set(readKey, lastRead), [readKey, lastRead])

  const latest = messages.findLast((m) => !m.pending)
  useEffect(() => {
    if (latest && tab === 'chat' && visible && time(latest.created_at) > time(lastRead)) setLastRead(latest.created_at)
  }, [latest, tab, visible, lastRead])

  const unread = messages.filter((m) => m.sender_id !== userId && time(m.created_at) > time(lastRead)).length

  useEffect(() => {
    document.title = unread ? `(${unread}) Duo` : 'Duo'
    if (unread) navigator.setAppBadge?.(unread).catch(() => {})
    else navigator.clearAppBadge?.().catch(() => {})
  }, [unread])

  const partnerName = partner?.display_name ?? 'Your person'
  const status = !partner
    ? 'Waiting for your person to join'
    : partnerTyping
      ? `${partnerName} is typing…`
      : partnerOnline
        ? `${partnerName} · online`
        : partnerName

  return (
    <NavContext.Provider value={nav}>
      <div className="app-height mx-auto flex max-w-2xl flex-col sm:border-x sm:border-line">
        <header className="shrink-0 border-b border-line bg-bg pt-[env(safe-area-inset-top)]">
          <div className="flex h-14 items-center gap-3 pr-2 pl-4">
            <span className="relative">
              <Avatar name={partner?.display_name ?? space?.name ?? 'Duo'} size={36} />
              {partnerOnline && (
                <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-bg bg-online" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate leading-tight font-semibold">{space?.name ?? 'Our space'}</div>
              <div className={cx('truncate text-xs', partnerTyping ? 'text-accent' : 'text-muted')}>{status}</div>
            </div>
            <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
              <Settings />
            </IconButton>
          </div>
        </header>

        <main className="relative min-h-0 flex-1">
          <TabPanel active={tab === 'chat'}>
            <ChatTab active={tab === 'chat'} />
          </TabPanel>
          <TabPanel active={tab === 'contacts'}>
            <ContactsTab />
          </TabPanel>
          <TabPanel active={tab === 'lists'}>
            <ListsTab />
          </TabPanel>
          <TabPanel active={tab === 'notes'}>
            <NotesTab />
          </TabPanel>
        </main>

        {!keyboardOpen && (
          <nav className="shrink-0 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
            <div className="grid grid-cols-4">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => nav.setTab(id)}
                  aria-current={tab === id ? 'page' : undefined}
                  className={cx(
                    'relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition',
                    tab === id ? 'text-accent' : 'text-muted hover:text-ink',
                  )}
                >
                  <Icon className="size-[22px]" strokeWidth={tab === id ? 2.4 : 2} />
                  {label}
                  {id === 'chat' && unread > 0 && (
                    <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] leading-[18px] font-semibold text-accent-ink">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </NavContext.Provider>
  )
}

/** Tabs stay mounted so scroll position, drafts and searches survive switching. */
function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className="absolute inset-0" hidden={!active}>
      {children}
    </div>
  )
}
