// All of a space's data, for the screens: loaded once and kept live, and
// encrypted and decrypted on this device so the server only ever stores
// ciphertext. This file wires the pieces together; each lives in ./space:
//
//   rows.ts       the rows as stored, and how they change
//   sync.ts       loading them and keeping them live over Realtime
//   device-key.ts this device's key for the space
//   plaintext.ts  decrypting rows into a cache as they arrive
//   view.ts       rows + plaintext → what the screens show
//   room.ts       who's online and typing, and setting up direct transfers
//   *-actions.ts  everything the screens can do, by area
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { inbox } from './inbox'
import type { StoredMember, StoredSpace } from './types'
import { emptyRows, rowsReducer } from './space/rows'
import { syncSpace } from './space/sync'
import { useDeviceKey } from './space/device-key'
import { usePlaintext } from './space/plaintext'
import { deriveView } from './space/view'
import { joinRoom, type Room } from './space/room'
import { records, type StoreDeps } from './space/records'
import { chatActions } from './space/chat-actions'
import { contentActions } from './space/content-actions'
import { encryptionActions } from './space/encryption-actions'

export { time } from './space/rows'

/** How long "is typing…" shows after the last ping. */
const TYPING_SHOWN_MS = 4000

function useSpaceStore(spaceId: string, user: User) {
  const userId = user.id
  const [rows, dispatch] = useReducer(rowsReducer, emptyRows)
  const [rawSpace, setRawSpace] = useState<StoredSpace | null>(null)
  const [rawMembers, setRawMembers] = useState<StoredMember[]>([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [partnerOnline, setPartnerOnline] = useState(false)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const room = useRef<Room | null>(null)
  const upgradePending = useRef(false)

  const { key, keyRef, setKey, loaded: keyLoaded } = useDeviceKey(spaceId, rawSpace?.e2e_check)
  const { plain, remember, forget } = usePlaintext(key, keyRef, { spaceId, rows, space: rawSpace, members: rawMembers })
  const view = useMemo(
    () => deriveView({ spaceId, rows, space: rawSpace, members: rawMembers, plain }),
    [spaceId, rows, rawSpace, rawMembers, plain],
  )

  // Latest values for the actions, which are created once.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const spaceRef = useRef(rawSpace)
  spaceRef.current = rawSpace
  const membersRef = useRef(rawMembers)
  membersRef.current = rawMembers
  const viewRef = useRef(view)
  viewRef.current = view

  // ─── Live: rows, and the room ────────────────────────────────────────

  useEffect(() => {
    let typingTimer: ReturnType<typeof setTimeout> | undefined
    const visible = () => document.visibilityState === 'visible'

    const sync = syncSpace({
      spaceId,
      userId,
      onRows: (r) => {
        dispatch({ type: 'load', rows: r })
        setReady(true)
        setLoadError(null)
      },
      onMeta: (s, m) => {
        setRawSpace(s)
        setRawMembers(m)
      },
      onChange: (c) => {
        if (c.type === 'upsert') return dispatch(c)
        dispatch(c)
        // A deleted message's photo or video can't be opened any more.
        if (c.table === 'messages') void inbox.remove(c.id).catch(() => {})
      },
      onPartnerMessage: () => setPartnerTyping(false),
      onError: setLoadError,
    })

    room.current = joinRoom({
      spaceId,
      userId,
      getKey: () => keyRef.current,
      isPartner: (id) => id !== userId && membersRef.current.some((m) => m.user_id === id),
      onPartner: ({ online }) => setPartnerOnline(online),
      onTyping: () => {
        setPartnerTyping(true)
        clearTimeout(typingTimer)
        typingTimer = setTimeout(() => setPartnerTyping(false), TYPING_SHOWN_MS)
      },
      onFile: (messageId, bytes) => inbox.put(messageId, bytes),
    })

    const onVisibility = () => {
      room.current?.syncPresence()
      if (visible()) void sync.reload()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearTimeout(typingTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      room.current?.close()
      room.current = null
      sync.close()
    }
  }, [spaceId, userId, keyRef])

  // Tell your person whether this device can take files directly right now
  // (it can't while it's locked).
  useEffect(() => {
    room.current?.syncPresence()
  }, [key])

  // ─── Actions ─────────────────────────────────────────────────────────

  const actions = useMemo(() => {
    const deps: StoreDeps = {
      spaceId,
      userId,
      dispatch,
      remember,
      forgetPlaintext: forget,
      key: keyRef,
      setKey,
      rows: rowsRef,
      space: spaceRef,
      members: membersRef,
      view: viewRef,
      setSpace: setRawSpace,
      setMembers: setRawMembers,
      room,
      upgradePending,
    }
    const r = records(deps)
    const content = contentActions(deps, r)
    return { ...chatActions(deps, r), ...content, ...encryptionActions(deps, r, content) }
  }, [spaceId, userId, remember, forget, keyRef, setKey])

  const me = view.members.find((m) => m.user_id === userId) ?? null
  const partner = view.members.find((m) => m.user_id !== userId) ?? null

  return {
    user,
    userId,
    ready: ready && rawSpace !== null,
    /** Set when the first load failed (later refetch failures keep the data we have). */
    loadError: ready ? null : loadError,
    space: view.space,
    members: view.members,
    me,
    partner,
    partnerOnline: partnerOnline && partner !== null,
    partnerTyping,
    contacts: view.contacts,
    messages: view.messages,
    notes: view.notes,
    lists: view.lists,
    list_items: view.list_items,
    /** Something this device can read is still being decrypted. */
    decrypting: Boolean(key) && view.decrypting,
    e2e: {
      /** Turned on for the space; once on, it stays on. */
      enabled: Boolean(rawSpace?.e2e_salt),
      /** This device has the key. */
      unlocked: key !== null,
      /** Done checking this device for a saved key. */
      ready: keyLoaded,
    },
    actions,
  }
}

export type SpaceData = ReturnType<typeof useSpaceStore>

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
  return (id: string | null) =>
    id === userId ? 'you' : (members.find((m) => m.user_id === id)?.display_name ?? 'your person')
}

// Realtime channels don't survive hot-swapping this module mid-session, so in
// dev an edit here reloads the page instead.
import.meta.hot?.dispose(() => location.reload())
