import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookUser, ListChecks, MessageCircle, Settings, StickyNote } from 'lucide-react'
import { useSpace, type SpaceActions } from '../lib/store'
import { useDocumentVisible, useKeyboardOpen } from '../lib/device'
import { deviceStorage } from '../lib/device-storage'
import type { Message } from '../lib/types'
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

export function Shell() {
  const { ready, loadError, e2e, decrypting, me } = useSpace()
  const slow = useTakingLong(ready)
  // Wait for the first decryption after unlocking, but don't flash a loading screen for every new message.
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (!e2e.unlocked) setOpened(false)
    else if (!decrypting) setOpened(true)
  }, [e2e.unlocked, decrypting])

  if (!ready) return loadError || slow ? <LoadProblem error={loadError} /> : <Splash />
  if (!e2e.ready) return <Splash />
  if (!e2e.enabled) return <SetUpScreen />
  if (!e2e.unlocked) return <UnlockScreen />
  if (!opened) return <Splash />
  if (!me?.display_name) return <NameScreen />
  return <ShellReady />
}

function useTakingLong(ready: boolean) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (ready) return
    const t = setTimeout(() => setSlow(true), 12_000)
    return () => clearTimeout(t)
  }, [ready])
  return slow
}

function LoadProblem({ error }: { error: string | null }) {
  return (
    <div className="app-height flex flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="font-semibold">{error ? "Couldn't load your space" : 'Still connecting…'}</p>
      {error && <p className="text-sm text-muted">{error}</p>}
      <Button onClick={() => location.reload()}>Try again</Button>
    </div>
  )
}

function ShellReady() {
  const { space, userId, messages, actions } = useSpace()
  const nav = useNavState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const keyboardOpen = useKeyboardOpen()
  const unread = useUnread(space!.id, messages, userId, nav.tab === 'chat')
  useTidyUpOnce(actions)
  return (
    <NavContext.Provider value={nav}>
      <div className="app-height mx-auto flex max-w-2xl flex-col sm:border-x sm:border-line">
        <ShellHeader onSettings={() => setSettingsOpen(true)} />
        <TabPanels tab={nav.tab} />
        {!keyboardOpen && <TabBar tab={nav.tab} unread={unread} onSelect={nav.setTab} />}
      </div>
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </NavContext.Provider>
  )
}

/** Once per visit: encrypts anything saved before encryption was on, and clears out finished photos and videos. */
function useTidyUpOnce(actions: SpaceActions) {
  const upgraded = useRef(false)
  useEffect(() => {
    if (upgraded.current) return
    upgraded.current = true
    actions.encryption
      .upgradeLegacy()
      .then((n) => n && toast(`Encrypted ${n} older item${n === 1 ? '' : 's'}`))
      .catch(toastError)
  }, [actions])
  useEffect(() => {
    actions.chat.sweepMedia().catch(() => {})
  }, [actions])
}

function useNavState(): Nav {
  const [tab, setTabState] = useState<Tab>(() => (deviceStorage.get('duo:tab') as Tab | null) ?? 'chat')
  const [focusContactId, setFocusContactId] = useState<string | null>(null)
  return useMemo(() => {
    const setTab = (t: Tab) => {
      setTabState(t)
      deviceStorage.set('duo:tab', t)
    }
    const openContact = (id: string) => {
      setFocusContactId(id)
      setTab('contacts')
    }
    return { tab, setTab, openContact, focusContactId, clearFocusContact: () => setFocusContactId(null) }
  }, [tab, focusContactId])
}

// Their messages newer than the last one you saw with Chat open; on a new device, history so far is read.
// Only server timestamps are compared, so a skewed phone clock can't hide messages.
function useUnread(spaceId: string, messages: Message[], userId: string, chatOpen: boolean): number {
  const visible = useDocumentVisible()
  const readKey = `duo:lastRead:${spaceId}`
  const latest = messages.findLast((m) => !m.pending)
  const [lastRead, setLastRead] = useState(() => deviceStorage.get(readKey) ?? latest?.created_at ?? new Date(0).toISOString())
  useEffect(() => deviceStorage.set(readKey, lastRead), [readKey, lastRead])
  useEffect(() => {
    if (latest && chatOpen && visible && Date.parse(latest.created_at) > Date.parse(lastRead)) setLastRead(latest.created_at)
  }, [latest, chatOpen, visible, lastRead])
  const unread = messages.filter((m) => m.sender_id !== userId && Date.parse(m.created_at) > Date.parse(lastRead)).length
  useEffect(() => {
    document.title = unread ? `(${unread}) Duo` : 'Duo'
    if (unread) navigator.setAppBadge?.(unread).catch(() => {})
    else navigator.clearAppBadge?.().catch(() => {})
  }, [unread])
  return unread
}

function ShellHeader({ onSettings }: { onSettings: () => void }) {
  const { space, partner, partnerOnline, partnerTyping } = useSpace()
  const name = partner?.display_name ?? 'Your person'
  const status = !partner ? 'Waiting for your person to join' : partnerTyping ? `${name} is typing…` : partnerOnline ? `${name} · online` : name
  return (
    <header className="shrink-0 border-b border-line bg-bg pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-3 pr-2 pl-4">
        <span className="relative">
          <Avatar name={partner?.display_name ?? space?.name ?? 'Duo'} size={36} />
          {partnerOnline && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-bg bg-online" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate leading-tight font-semibold">{space?.name ?? 'Our space'}</div>
          <div className={cx('truncate text-xs', partnerTyping ? 'text-accent' : 'text-muted')}>{status}</div>
        </div>
        <IconButton label="Settings" onClick={onSettings}>
          <Settings />
        </IconButton>
      </div>
    </header>
  )
}

function TabBar({ tab, unread, onSelect }: { tab: Tab; unread: number; onSelect: (t: Tab) => void }) {
  return (
    <nav className="shrink-0 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
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
  )
}

/** Tabs stay mounted so scroll position, drafts and searches survive switching. */
function TabPanels({ tab }: { tab: Tab }) {
  return (
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
  )
}

function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className="absolute inset-0" hidden={!active}>
      {children}
    </div>
  )
}
