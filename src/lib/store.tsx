// All of a space's data lives here: loaded once, then kept live over one
// Supabase Realtime channel (row changes + presence + typing), and refetched
// whenever the app comes back to the foreground.
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel, User } from '@supabase/supabase-js'
import { must, supabase } from './supabase'
import { errorMessage } from '../components/ui'
import { toCard, type Contact, type ContactInput, type List, type ListItem, type Member, type Message, type Note, type Space } from './types'
import type { ContactCard } from './vcard'
import { decryptMessage, deriveKey, encryptMessage, keyMatches, makeCheck, newSalt, type MessageContent } from './e2e'
import { keystore } from './keystore'

type Rows = {
  contacts: Contact[]
  messages: Message[]
  notes: Note[]
  lists: List[]
  list_items: ListItem[]
}
type Table = keyof Rows
type RowOf<T extends Table> = Rows[T][number]
type AnyRow = { id: string }

const TABLES: Table[] = ['contacts', 'messages', 'notes', 'lists', 'list_items']

// Realtime channels don't survive hot-swapping this module mid-session, so in
// dev an edit here reloads the page instead.
import.meta.hot?.dispose(() => location.reload())
const MESSAGE_LIMIT = 500

export const time = (iso: string) => new Date(iso).getTime()

const sorters: { [T in Table]: (a: RowOf<T>, b: RowOf<T>) => number } = {
  contacts: (a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }),
  messages: (a, b) => time(a.created_at) - time(b.created_at),
  notes: (a, b) => Number(b.pinned) - Number(a.pinned) || time(b.updated_at) - time(a.updated_at),
  lists: (a, b) => time(a.created_at) - time(b.created_at),
  list_items: (a, b) => time(a.created_at) - time(b.created_at),
}

const sorted = <T extends Table>(table: T, rows: AnyRow[]) =>
  [...rows].sort(sorters[table] as (a: AnyRow, b: AnyRow) => number) as Rows[T]

type Action =
  | { type: 'load'; rows: Rows }
  | { type: 'upsert'; table: Table; row: AnyRow }
  | { type: 'remove'; table: Table; id: string }
  /** Swaps an optimistic row (temp id) for the confirmed one. */
  | { type: 'confirm'; table: Table; tempId: string; row: AnyRow }

function reducer(state: Rows, a: Action): Rows {
  switch (a.type) {
    case 'load': {
      // Keep messages still in flight; the load can't know about them yet.
      const pending = state.messages.filter((m) => m.pending)
      return { ...a.rows, messages: sorted('messages', [...a.rows.messages, ...pending]) }
    }
    case 'upsert': {
      const rows = (state[a.table] as AnyRow[]).filter((r) => r.id !== a.row.id)
      return { ...state, [a.table]: sorted(a.table, [...rows, a.row]) }
    }
    case 'confirm': {
      const rows = (state[a.table] as AnyRow[]).filter((r) => r.id !== a.tempId && r.id !== a.row.id)
      return { ...state, [a.table]: sorted(a.table, [...rows, a.row]) }
    }
    case 'remove': {
      const next = { ...state, [a.table]: (state[a.table] as AnyRow[]).filter((r) => r.id !== a.id) }
      if (a.table === 'lists') next.list_items = state.list_items.filter((i) => i.list_id !== a.id)
      return next
    }
  }
}

const emptyRows: Rows = { contacts: [], messages: [], notes: [], lists: [], list_items: [] }

// Leaving a channel is async. Until it finishes, the old channel still owns the
// name, so the next join waits for it.
let roomLeaving: Promise<unknown> = Promise.resolve()

function leaveRoom(room: RealtimeChannel) {
  roomLeaving = supabase.removeChannel(room)
}

async function roomReady(name: string) {
  await roomLeaving
  // If the leave timed out (say, offline), the dead channel is still
  // registered under the name; try once more to clear it.
  const leftover = supabase.getChannels().find((c) => c.topic === `realtime:${name}`)
  if (leftover) await supabase.removeChannel(leftover)
}

function useSpaceStore(spaceId: string, user: User) {
  const userId = user.id
  const [rows, dispatch] = useReducer(reducer, emptyRows)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [space, setSpace] = useState<Space | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [partnerOnline, setPartnerOnline] = useState(false)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastTypingSent = useRef(0)

  // End-to-end encryption: this device's key for the space (null = locked),
  // and the plaintext of every message it has decrypted, by message id.
  const [e2eKey, setE2eKey] = useState<CryptoKey | null>(null)
  const [keyLoaded, setKeyLoaded] = useState(false)
  const [plain, setPlain] = useState<Record<string, MessageContent | 'failed'>>({})
  const keyRef = useRef(e2eKey)
  keyRef.current = e2eKey
  const spaceRef = useRef(space)
  spaceRef.current = space

  useEffect(() => {
    let alive = true
    keystore
      .get(spaceId)
      .then((k) => {
        if (alive && k) setE2eKey(k)
      })
      .catch(() => {}) // no IndexedDB: the passphrase is asked for each session
      .finally(() => alive && setKeyLoaded(true))
    return () => {
      alive = false
    }
  }, [spaceId])

  // A key saved on this device that no longer matches the space is useless; forget it.
  useEffect(() => {
    if (!e2eKey || !space?.e2e_check) return
    void keyMatches(e2eKey, spaceId, space.e2e_check).then((ok) => {
      if (ok) return
      setE2eKey(null)
      void keystore.remove(spaceId).catch(() => {})
    })
  }, [e2eKey, space?.e2e_check, spaceId])

  // Decrypt whatever arrived that we haven't read yet.
  useEffect(() => {
    if (!e2eKey) return
    const todo = rows.messages.filter((m) => m.cipher && !(m.id in plain))
    if (!todo.length) return
    let alive = true
    void Promise.all(
      todo.map(async (m) => {
        try {
          return [m.id, await decryptMessage(e2eKey, { spaceId, senderId: m.sender_id, messageId: m.id }, m.cipher!)] as const
        } catch {
          return [m.id, 'failed' as const] as const
        }
      }),
    ).then((results) => {
      if (alive) setPlain((p) => ({ ...p, ...Object.fromEntries(results) }))
    })
    return () => {
      alive = false
    }
  }, [rows.messages, e2eKey, plain, spaceId])

  useEffect(() => {
    let alive = true
    let typingTimer: ReturnType<typeof setTimeout> | undefined

    const loadMeta = async () => {
      const [s, m] = await Promise.all([
        must<Space>(supabase.from('spaces').select('*').eq('id', spaceId).single()),
        must<Member[]>(supabase.from('members').select('*').eq('space_id', spaceId).order('joined_at')),
      ])
      if (!alive) return
      setSpace(s)
      setMembers(m)
    }

    const loadAll = async () => {
      const inSpace = (t: Table) => supabase.from(t).select('*').eq('space_id', spaceId)
      try {
        const [contacts, messages, notes, lists, list_items] = await Promise.all([
          must<Contact[]>(inSpace('contacts')),
          must<Message[]>(inSpace('messages').order('created_at', { ascending: false }).limit(MESSAGE_LIMIT)),
          must<Note[]>(inSpace('notes')),
          must<List[]>(inSpace('lists')),
          must<ListItem[]>(inSpace('list_items')),
          loadMeta(),
        ])
        if (!alive) return
        dispatch({
          type: 'load',
          rows: {
            contacts: sorted('contacts', contacts),
            messages: sorted('messages', messages),
            notes: sorted('notes', notes),
            lists: sorted('lists', lists),
            list_items: sorted('list_items', list_items),
          },
        })
        setReady(true)
        setLoadError(null)
      } catch (e) {
        console.error('Loading space failed', e)
        if (alive) setLoadError(errorMessage(e))
      }
    }

    // Two channels. Row changes go on one with a name unique to this mount:
    // supabase.channel(name) hands back any existing channel with that name,
    // including one still being torn down by a previous mount (StrictMode, hot
    // reload, signing out and in), and reusing that one goes silently dead.
    const changes = supabase.channel(`changes:${spaceId}:${Math.random().toString(36).slice(2)}`)

    for (const table of TABLES) {
      // Unfiltered on purpose: Realtime can't filter DELETEs, and RLS already
      // limits inserts/updates to our space. A DELETE only carries the id, so
      // removing an id we don't have is a no-op.
      changes.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
        if (p.eventType === 'DELETE') {
          const id = (p.old as Partial<AnyRow>).id
          if (id) dispatch({ type: 'remove', table, id })
          return
        }
        const row = p.new as AnyRow & { space_id: string; sender_id?: string }
        if (row.space_id !== spaceId) return
        dispatch({ type: 'upsert', table, row })
        if (table === 'messages' && row.sender_id !== userId) setPartnerTyping(false)
      })
    }
    for (const table of ['spaces', 'members']) {
      changes.on('postgres_changes', { event: '*', schema: 'public', table }, () => void loadMeta().catch(console.error))
    }
    changes.subscribe((status) => {
      if (status === 'SUBSCRIBED') void loadAll() // catches anything that changed while (re)connecting
    })
    void loadAll()

    // Presence and typing need a name both of you share, so wait until any
    // previous instance of it has fully left before joining again.
    const visible = () => document.visibilityState === 'visible'
    let room: RealtimeChannel | null = null
    void roomReady(`room:${spaceId}`).then(() => {
      if (!alive) return
      const r = supabase.channel(`room:${spaceId}`, { config: { presence: { key: userId } } })
      room = r
      channelRef.current = r
      r.on('presence', { event: 'sync' }, () => {
        setPartnerOnline(Object.keys(r.presenceState()).some((key) => key !== userId))
      })
      r.on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.user_id === userId) return
        setPartnerTyping(true)
        clearTimeout(typingTimer)
        typingTimer = setTimeout(() => setPartnerTyping(false), 4000)
      })
      r.subscribe((status) => {
        if (status === 'SUBSCRIBED' && visible()) void r.track({ at: Date.now() })
      })
    })

    // "Online" means the app is open in front of you, not just running somewhere.
    const onVisibility = () => {
      if (visible()) {
        void room?.track({ at: Date.now() })
        void loadAll()
      } else {
        void room?.untrack()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      alive = false
      clearTimeout(typingTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      channelRef.current = null
      void supabase.removeChannel(changes)
      if (room) leaveRoom(room)
    }
  }, [spaceId, userId])

  const actions = useMemo(() => {
    const upsert = (table: Table, row: AnyRow) => dispatch({ type: 'upsert', table, row })
    const remove = (table: Table, id: string) => dispatch({ type: 'remove', table, id })

    /** Applies a patch locally right away, then on the server; rolls back if that fails. */
    async function update<T extends Table>(table: T, id: string, patch: Partial<RowOf<T>>): Promise<RowOf<T>> {
      const before = (rowsRef.current[table] as AnyRow[]).find((r) => r.id === id)
      if (before) upsert(table, { ...before, ...patch })
      try {
        const row = await must<RowOf<T>>(
          supabase.from(table).update(patch as Record<string, unknown>).eq('id', id).select().single(),
        )
        upsert(table, row)
        return row
      } catch (e) {
        if (before) upsert(table, before)
        throw e
      }
    }

    async function insert<T extends Table>(table: T, values: object): Promise<RowOf<T>> {
      const row = await must<RowOf<T>>(supabase.from(table).insert({ ...values, space_id: spaceId }).select().single())
      upsert(table, row)
      return row
    }

    async function del(table: Table, id: string) {
      await must(supabase.from(table).delete().eq('id', id))
      remove(table, id)
    }

    return {
      async sendMessage(input: { body?: string; contact?: ContactCard }) {
        const key = keyRef.current
        if (!key) throw new Error('Unlock encryption in Chat before sending.')
        // The id is chosen here so it can be sealed into the ciphertext.
        const id = crypto.randomUUID()
        const content: MessageContent = { body: input.body?.trim() || null, contact: input.contact ? toCard(input.contact) : null }
        const cipher = await encryptMessage(key, { spaceId, senderId: userId, messageId: id }, content)
        setPlain((p) => ({ ...p, [id]: content }))
        const temp: Message = {
          id,
          space_id: spaceId,
          sender_id: userId,
          created_at: new Date().toISOString(),
          pending: true,
          body: null,
          contact: null,
          cipher,
        }
        upsert('messages', temp)
        try {
          const row = await must<Message>(supabase.from('messages').insert({ id, space_id: spaceId, cipher }).select().single())
          dispatch({ type: 'confirm', table: 'messages', tempId: id, row })
        } catch (e) {
          remove('messages', id)
          throw e
        }
      },
      deleteMessage: (id: string) => del('messages', id),

      addContact: (input: ContactInput) => insert('contacts', input),
      updateContact: (id: string, patch: Partial<ContactInput>) => update('contacts', id, patch),
      deleteContact: (id: string) => del('contacts', id),
      async importContacts(cards: ContactCard[]): Promise<number> {
        let added = 0
        for (let i = 0; i < cards.length; i += 200) {
          const batch = cards.slice(i, i + 200).map((c) => ({ ...toCard(c), space_id: spaceId }))
          const inserted = await must<Contact[]>(supabase.from('contacts').insert(batch).select())
          inserted.forEach((r) => upsert('contacts', r))
          added += inserted.length
        }
        return added
      },

      addNote: (input: Pick<Note, 'title' | 'body' | 'pinned'>) => insert('notes', input),
      updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'pinned'>>) => update('notes', id, patch),
      deleteNote: (id: string) => del('notes', id),

      addList: (input: Pick<List, 'title' | 'emoji'>) => insert('lists', input),
      updateList: (id: string, patch: Partial<Pick<List, 'title' | 'emoji'>>) => update('lists', id, patch),
      deleteList: (id: string) => del('lists', id),

      addItem: (listId: string, text: string) => insert('list_items', { list_id: listId, text: text.trim() }),
      updateItem: (id: string, patch: Partial<Pick<ListItem, 'text' | 'done' | 'due_date'>>) => update('list_items', id, patch),
      deleteItem: (id: string) => del('list_items', id),
      async clearDone(listId: string) {
        const done = rowsRef.current.list_items.filter((i) => i.list_id === listId && i.done)
        await must(supabase.from('list_items').delete().eq('list_id', listId).eq('done', true))
        done.forEach((i) => remove('list_items', i.id))
      },

      async renameSpace(name: string) {
        const s = await must<Space>(supabase.from('spaces').update({ name }).eq('id', spaceId).select().single())
        setSpace(s)
      },
      async renameMe(display_name: string) {
        await must(supabase.from('members').update({ display_name }).eq('user_id', userId))
        setMembers((ms) => ms.map((m) => (m.user_id === userId ? { ...m, display_name } : m)))
      },

      /** Turns on end-to-end encryption for the space, with a passphrase you both know. */
      async setUpEncryption(passphrase: string) {
        const salt = newSalt()
        const key = await deriveKey(passphrase, salt)
        const check = await makeCheck(key, spaceId)
        await must(supabase.rpc('enable_e2e', { salt, check_value: check }))
        setSpace((s) => s && { ...s, e2e_salt: salt, e2e_check: check })
        await keystore.set(spaceId, key).catch(() => {})
        setE2eKey(key)
      },

      /** Unlocks this device with the passphrase. Throws if it's not the right one. */
      async unlockEncryption(passphrase: string) {
        const s = spaceRef.current
        if (!s?.e2e_salt || !s.e2e_check) throw new Error('Encryption is not set up yet.')
        const key = await deriveKey(passphrase, s.e2e_salt)
        if (!(await keyMatches(key, spaceId, s.e2e_check))) throw new Error('That passphrase does not match.')
        await keystore.set(spaceId, key).catch(() => {})
        setE2eKey(key)
      },

      /** Forgets the key on this device; messages stay encrypted until it's unlocked again. */
      async lockDevice() {
        await keystore.remove(spaceId).catch(() => {})
        setE2eKey(null)
        setPlain({})
      },

      /** Throttled "is typing" ping to the other person. */
      typing() {
        const now = Date.now()
        if (now - lastTypingSent.current < 2500) return
        lastTypingSent.current = now
        void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId } })
      },
    }
  }, [spaceId, userId])

  const me = members.find((m) => m.user_id === userId) ?? null
  const partner = members.find((m) => m.user_id !== userId) ?? null

  // Messages as the app shows them: encrypted ones with their plaintext filled in.
  const messages = useMemo(
    () =>
      rows.messages.map((m): Message => {
        if (!m.cipher) return m
        const p = plain[m.id]
        if (p === 'failed') return { ...m, undecryptable: true }
        if (!p) return { ...m, locked: true }
        return { ...m, ...p }
      }),
    [rows.messages, plain],
  )

  return {
    user,
    userId,
    ready: ready && space !== null,
    /** Set when the first load failed (later refetch failures keep the data we have). */
    loadError: ready ? null : loadError,
    space,
    members,
    me,
    partner,
    partnerOnline: partnerOnline && partner !== null,
    partnerTyping,
    ...rows,
    messages,
    e2e: {
      /** Turned on for the space; once on, it stays on. */
      enabled: Boolean(space?.e2e_salt),
      /** This device has the key. */
      unlocked: e2eKey !== null,
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
  return (id: string | null) => (id === userId ? 'you' : (members.find((m) => m.user_id === id)?.display_name ?? 'someone'))
}
