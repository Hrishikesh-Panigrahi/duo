// All of a space's data for the screens, kept live, and encrypted and decrypted on this device so the
// server only ever stores ciphertext. Each piece lives in ./space; this wires them together.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { User } from '@supabase/supabase-js'
import { inbox } from './inbox'
import type { Member, StoredMember, StoredSpace } from './types'
import { emptyRows, rowsReducer, type RowAction } from './space/rows'
import { SpaceSync, type RowChange } from './space/sync'
import { useDeviceKey, type DeviceKey } from './space/device-key'
import { usePlaintext, type Plaintext } from './space/plaintext'
import { deriveView, type SpaceView } from './space/view'
import { Room } from './space/room'
import { Records, type StoreDeps } from './space/records'
import { ChatActions } from './space/chat-actions'
import { ContactActions, ListActions, NameActions, NoteActions } from './space/content-actions'
import { EncryptionActions } from './space/encryption-actions'

/** How long "is typing…" shows after the last ping. */
const TYPING_SHOWN_MS = 4000

export type SpaceActions = {
  chat: ChatActions
  contacts: ContactActions
  notes: NoteActions
  lists: ListActions
  names: NameActions
  encryption: EncryptionActions
}

export type SpaceData = SpaceView & {
  user: User
  userId: string
  ready: boolean
  /** Set when the first load failed (later refetch failures keep the data we have). */
  loadError: string | null
  me: Member | null
  partner: Member | null
  partnerOnline: boolean
  partnerTyping: boolean
  e2e: {
    /** Turned on for the space; once on, it stays on. */
    enabled: boolean
    /** This device has the key. */
    unlocked: boolean
    /** Done checking this device for a saved key. */
    ready: boolean
  }
  actions: SpaceActions
}

type Stored = ReturnType<typeof useSyncedSpace>

/** The space's rows, space and members as stored: loaded, then kept live. */
function useSyncedSpace(spaceId: string, userId: string, onPartnerMessage: () => void) {
  const [rows, dispatch] = useReducer(rowsReducer, emptyRows)
  const [space, setSpace] = useState<StoredSpace | null>(null)
  const [members, setMembers] = useState<StoredMember[]>([])
  const [load, setLoad] = useState<{ ready: boolean; error: string | null }>({ ready: false, error: null })
  useEffect(() => {
    const sync = new SpaceSync({
      spaceId,
      userId,
      onRows: (loaded) => {
        dispatch({ type: 'load', rows: loaded })
        setLoad({ ready: true, error: null })
      },
      onSpace: setSpace,
      onMembers: setMembers,
      onChange: (change) => applyChange(dispatch, change),
      onPartnerMessage,
      onError: (error) => setLoad((l) => ({ ...l, error })),
    })
    const reloadWhenBack = () => document.visibilityState === 'visible' && void sync.reload()
    document.addEventListener('visibilitychange', reloadWhenBack)
    return () => {
      document.removeEventListener('visibilitychange', reloadWhenBack)
      sync.close()
    }
  }, [spaceId, userId, onPartnerMessage])
  return { rows, dispatch, space, setSpace, members, setMembers, ...load }
}

function applyChange(dispatch: (a: RowAction) => void, change: RowChange) {
  dispatch(change)
  // A deleted message's photo or video can't be opened any more.
  if (change.type === 'remove' && change.table === 'messages') void inbox.remove(change.id).catch(() => {})
}

/** "Is typing…" shows for a few seconds after each ping, or until their message arrives. */
function usePartnerTyping() {
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback(() => {
    setShown(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setShown(false), TYPING_SHOWN_MS)
  }, [])
  const hide = useCallback(() => setShown(false), [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return { shown, show, hide }
}

/** The live room: who's online and typing, and direct transfers. */
function useRoom(spaceId: string, userId: string, device: DeviceKey, members: RefObject<StoredMember[]>, onTyping: () => void) {
  const room = useRef<Room | null>(null)
  const [partnerOnline, setPartnerOnline] = useState(false)
  const { key, keyRef } = device
  useEffect(() => {
    const live = new Room({
      spaceId,
      userId,
      getKey: () => keyRef.current,
      isPartner: (id) => id !== userId && members.current.some((m) => m.user_id === id),
      onPartner: ({ online }) => setPartnerOnline(online),
      onTyping,
      onFile: (messageId, bytes) => inbox.put(messageId, bytes),
    })
    room.current = live
    const announce = () => live.syncPresence()
    document.addEventListener('visibilitychange', announce)
    return () => {
      document.removeEventListener('visibilitychange', announce)
      live.close()
      room.current = null
    }
  }, [spaceId, userId, keyRef, members, onTyping])
  // Whether this device can take files directly changes with the key (it can't while locked).
  useEffect(() => room.current?.syncPresence(), [key])
  return { room, partnerOnline }
}

type Latest = ReturnType<typeof useLatest>

/** The latest stored state and view, for code that runs outside a render. */
function useLatest(stored: Stored, view: SpaceView) {
  const rows = useRef(stored.rows)
  rows.current = stored.rows
  const space = useRef(stored.space)
  space.current = stored.space
  const members = useRef(stored.members)
  members.current = stored.members
  const latestView = useRef(view)
  latestView.current = view
  return { rows, space, members, view: latestView }
}

type ActionInputs = { spaceId: string; userId: string; stored: Stored; device: DeviceKey; plaintext: Plaintext; latest: Latest; room: RefObject<Room | null> }

/** Everything the screens can do. Created once, so they read the latest state through refs. */
function useActions({ spaceId, userId, stored, device, plaintext, latest, room }: ActionInputs): SpaceActions {
  const { dispatch, setSpace, setMembers } = stored
  const { keyRef: key, setKey } = device
  const { remember, forget: forgetPlaintext } = plaintext
  const { rows, space, members, view } = latest
  return useMemo(() => {
    const d: StoreDeps = { spaceId, userId, dispatch, remember, forgetPlaintext, key, setKey, rows, space, members, view, setSpace, setMembers, room }
    const records = new Records(d)
    const names = new NameActions(d, records)
    return {
      chat: new ChatActions(d, records),
      contacts: new ContactActions(d, records),
      notes: new NoteActions(d, records),
      lists: new ListActions(d, records),
      names,
      encryption: new EncryptionActions(d, records, names),
    }
  }, [spaceId, userId, dispatch, remember, forgetPlaintext, key, setKey, rows, space, members, view, setSpace, setMembers, room])
}

function useSpaceStore(spaceId: string, user: User): SpaceData {
  const userId = user.id
  const typing = usePartnerTyping()
  const stored = useSyncedSpace(spaceId, userId, typing.hide)
  const device = useDeviceKey(spaceId, stored.space?.e2e_check)
  const plaintext = usePlaintext(device.key, device.keyRef, { spaceId, ...stored })
  const { rows, space, members } = stored
  const view = useMemo(() => deriveView({ spaceId, rows, space, members, plain: plaintext.plain }), [spaceId, rows, space, members, plaintext.plain])
  const latest = useLatest(stored, view)
  const { room, partnerOnline } = useRoom(spaceId, userId, device, latest.members, typing.show)
  const actions = useActions({ spaceId, userId, stored, device, plaintext, latest, room })
  const partner = view.members.find((m) => m.user_id !== userId) ?? null
  return {
    ...view,
    user,
    userId,
    ready: stored.ready && space !== null,
    loadError: stored.ready ? null : stored.error,
    me: view.members.find((m) => m.user_id === userId) ?? null,
    partner,
    partnerOnline: partnerOnline && partner !== null,
    partnerTyping: typing.shown,
    decrypting: Boolean(device.key) && view.decrypting,
    e2e: { enabled: Boolean(space?.e2e_salt), unlocked: device.key !== null, ready: device.loaded },
    actions,
  }
}

const SpaceContext = createContext<SpaceData | null>(null)

export function SpaceProvider({ spaceId, user, children }: { spaceId: string; user: User; children: ReactNode }) {
  const value = useSpaceStore(spaceId, user)
  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>
}

export function useSpace(): SpaceData {
  const v = useContext(SpaceContext)
  if (!v) throw new Error('useSpace must be used inside <SpaceProvider>')
  return v
}

/** Display name for whoever created a row. */
export function useAuthorName() {
  const { members, userId } = useSpace()
  return (id: string | null) => (id === userId ? 'you' : (members.find((m) => m.user_id === id)?.display_name ?? 'your person'))
}

// Realtime channels don't survive hot-swapping this module, so in dev an edit here reloads the page.
import.meta.hot?.dispose(() => location.reload())
