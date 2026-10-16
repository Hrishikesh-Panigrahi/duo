// All of a space's data lives here. It's loaded once, kept live over Supabase
// Realtime (row changes + presence + typing), refetched when the app comes back
// to the foreground, and encrypted and decrypted on this device: the server
// only ever stores ciphertext.
//
// Rows are kept exactly as stored (ciphertext plus ids and timestamps), and a
// cache maps each ciphertext to its plaintext once decrypted. What the screens
// see is derived from the two.
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel, User } from '@supabase/supabase-js'
import { must, supabase } from './supabase'
import { errorMessage } from '../components/ui'
import {
  toCard,
  type Contact,
  type ContactContent,
  type ContactInput,
  type ItemContent,
  type List,
  type ListContent,
  type ListItem,
  type Member,
  type Message,
  type Note,
  type NoteContent,
  type Space,
  type StoredContact,
  type StoredItem,
  type StoredList,
  type StoredMember,
  type StoredMessage,
  type StoredNote,
  type StoredSpace,
} from './types'
import type { ContactCard } from './vcard'
import {
  contexts,
  decryptBytes,
  decryptMessage,
  decryptRecord,
  deriveKey,
  encryptBytes,
  encryptMessage,
  encryptRecord,
  keyMatches,
  makeCheck,
  newSalt,
  type MessageContent,
  type MessageIds,
} from './e2e'
import { keystore } from './keystore'
import { isExpired, mediaPath, prepareMedia } from './media'

type Rows = {
  contacts: StoredContact[]
  messages: StoredMessage[]
  notes: StoredNote[]
  lists: StoredList[]
  list_items: StoredItem[]
}
type Table = keyof Rows
type AnyRow = { id: string; created_at: string }

const TABLES: Table[] = ['contacts', 'messages', 'notes', 'lists', 'list_items']
const MESSAGE_LIMIT = 500
const MEDIA_BUCKET = 'media'

// Realtime channels don't survive hot-swapping this module mid-session, so in
// dev an edit here reloads the page instead.
import.meta.hot?.dispose(() => location.reload())

export const time = (iso: string) => new Date(iso).getTime()
const byCreated = (a: AnyRow, b: AnyRow) => time(a.created_at) - time(b.created_at)
const sorted = <T extends AnyRow>(rows: T[]) => [...rows].sort(byCreated)

type Action =
  | { type: 'load'; rows: Rows }
  | { type: 'upsert'; table: Table; row: AnyRow }
  | { type: 'remove'; table: Table; id: string }
  /** Swaps one row for another (an optimistic row for the confirmed one, or an old id for a new one). */
  | { type: 'confirm'; table: Table; tempId: string; row: AnyRow }

function reducer(state: Rows, a: Action): Rows {
  switch (a.type) {
    case 'load': {
      // Keep messages still in flight; the load can't know about them yet.
      const pending = state.messages.filter((m) => m.pending && !a.rows.messages.some((r) => r.id === m.id))
      return { ...a.rows, messages: sorted([...a.rows.messages, ...pending]) }
    }
    case 'upsert': {
      const rows = (state[a.table] as AnyRow[]).filter((r) => r.id !== a.row.id)
      return { ...state, [a.table]: sorted([...rows, a.row]) }
    }
    case 'confirm': {
      const rows = (state[a.table] as AnyRow[]).filter((r) => r.id !== a.tempId && r.id !== a.row.id)
      return { ...state, [a.table]: sorted([...rows, a.row]) }
    }
    case 'remove': {
      const next = { ...state, [a.table]: (state[a.table] as AnyRow[]).filter((r) => r.id !== a.id) }
      if (a.table === 'lists') next.list_items = state.list_items.filter((i) => i.list_id !== a.id)
      return next
    }
  }
}

const emptyRows: Rows = { contacts: [], messages: [], notes: [], lists: [], list_items: [] }

// Every write also clears the old plaintext columns, so rows from before
// encryption pass the database's ciphertext-only rules once they're updated.
const CLEARED = {
  contacts: {
    full_name: null,
    phones: [],
    emails: [],
    company: null,
    address: null,
    birthday: null,
    notes: null,
    tags: [],
    favorite: false,
  },
  notes: { title: '', body: '', pinned: false },
  lists: { title: null, emoji: null },
  list_items: { text: null, done: false, due_date: null },
}

// Reading rows from before encryption.
const legacy = {
  contact: (r: StoredContact): ContactContent => ({
    full_name: r.full_name ?? '',
    phones: r.phones ?? [],
    emails: r.emails ?? [],
    company: r.company ?? null,
    address: r.address ?? null,
    birthday: r.birthday ?? null,
    notes: r.notes ?? null,
    tags: r.tags ?? [],
    favorite: r.favorite ?? false,
  }),
  note: (r: StoredNote): NoteContent => ({ title: r.title ?? '', body: r.body ?? '', pinned: r.pinned ?? false }),
  list: (r: StoredList): ListContent => ({ title: r.title ?? '', emoji: r.emoji ?? null }),
  item: (r: StoredItem): ItemContent => ({ text: r.text ?? '', done: r.done ?? false, due_date: r.due_date ?? null }),
}

const FAILED = Symbol('decryption failed')
const cacheKey = (context: string, cipher: string) => `${context}|${cipher}`

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

const byName = (a: Contact, b: Contact) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })
const notesOrder = (a: Note, b: Note) => Number(b.pinned) - Number(a.pinned) || time(b.updated_at) - time(a.updated_at)

function useSpaceStore(spaceId: string, user: User) {
  const userId = user.id
  const [rows, dispatch] = useReducer(reducer, emptyRows)
  const [rawSpace, setRawSpace] = useState<StoredSpace | null>(null)
  const [rawMembers, setRawMembers] = useState<StoredMember[]>([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [partnerOnline, setPartnerOnline] = useState(false)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastTypingSent = useRef(0)

  // This device's key for the space (null = locked), and decrypted plaintext
  // keyed by context + ciphertext.
  const [e2eKey, setE2eKey] = useState<CryptoKey | null>(null)
  const [keyLoaded, setKeyLoaded] = useState(false)
  const [plain, setPlain] = useState<Map<string, unknown>>(() => new Map())
  const inflight = useRef(new Set<string>())

  // Latest values for the actions, which are created once.
  const keyRef = useRef(e2eKey)
  keyRef.current = e2eKey
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const rawSpaceRef = useRef(rawSpace)
  rawSpaceRef.current = rawSpace
  const rawMembersRef = useRef(rawMembers)
  rawMembersRef.current = rawMembers

  const remember = (entries: (readonly [string, unknown])[]) =>
    setPlain((prev) => {
      const next = new Map(prev)
      for (const [k, v] of entries) next.set(k, v)
      return next
    })

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
    if (!e2eKey || !rawSpace?.e2e_check) return
    void keyMatches(e2eKey, spaceId, rawSpace.e2e_check).then((ok) => {
      if (ok) return
      setE2eKey(null)
      void keystore.remove(spaceId).catch(() => {})
    })
  }, [e2eKey, rawSpace?.e2e_check, spaceId])

  // ─── Loading and live updates ────────────────────────────────────────

  useEffect(() => {
    let alive = true
    let typingTimer: ReturnType<typeof setTimeout> | undefined

    const loadMeta = async () => {
      const [s, m] = await Promise.all([
        must<StoredSpace>(supabase.from('spaces').select('*').eq('id', spaceId).single()),
        must<StoredMember[]>(supabase.from('members').select('*').eq('space_id', spaceId).order('joined_at')),
      ])
      if (!alive) return
      setRawSpace(s)
      setRawMembers(m)
    }

    const loadAll = async () => {
      const inSpace = (t: Table) => supabase.from(t).select('*').eq('space_id', spaceId)
      try {
        const [contacts, messages, notes, lists, list_items] = await Promise.all([
          must<StoredContact[]>(inSpace('contacts')),
          must<StoredMessage[]>(inSpace('messages').order('created_at', { ascending: false }).limit(MESSAGE_LIMIT)),
          must<StoredNote[]>(inSpace('notes')),
          must<StoredList[]>(inSpace('lists')),
          must<StoredItem[]>(inSpace('list_items')),
          loadMeta(),
        ])
        if (!alive) return
        dispatch({
          type: 'load',
          rows: {
            contacts: sorted(contacts),
            messages: sorted(messages),
            notes: sorted(notes),
            lists: sorted(lists),
            list_items: sorted(list_items),
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
        if (table === 'messages' && p.eventType === 'INSERT' && row.sender_id !== userId) setPartnerTyping(false)
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

  // ─── Decryption ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!e2eKey) return
    const jobs: { key: string; run: () => Promise<unknown> }[] = []
    const add = (context: string, cipher: string | null | undefined, run: (c: string) => Promise<unknown>) => {
      if (!cipher) return
      const key = cacheKey(context, cipher)
      if (plain.has(key) || inflight.current.has(key)) return
      jobs.push({ key, run: () => run(cipher) })
    }
    const addRecord = (context: string, cipher: string | null | undefined) =>
      add(context, cipher, (c) => decryptRecord(e2eKey, context, c))

    for (const r of rows.contacts) addRecord(contexts.contact(spaceId, r.id), r.cipher)
    for (const r of rows.notes) addRecord(contexts.note(spaceId, r.id), r.cipher)
    for (const r of rows.lists) addRecord(contexts.list(spaceId, r.id), r.cipher)
    for (const r of rows.list_items) addRecord(contexts.item(spaceId, r.list_id, r.id), r.cipher)
    for (const r of rows.messages) {
      const ids: MessageIds = { spaceId, senderId: r.sender_id, messageId: r.id }
      add(contexts.message(ids), r.cipher, (c) => decryptMessage(e2eKey, ids, c))
    }
    if (rawSpace) addRecord(contexts.spaceName(spaceId), rawSpace.name_cipher)
    for (const m of rawMembers) addRecord(contexts.memberName(spaceId, m.user_id), m.display_name_cipher)
    if (!jobs.length) return

    jobs.forEach((j) => inflight.current.add(j.key))
    void Promise.all(
      jobs.map(async (j) => {
        try {
          return [j.key, await j.run()] as const
        } catch {
          return [j.key, FAILED] as const
        }
      }),
    ).then((entries) => {
      entries.forEach(([k]) => inflight.current.delete(k))
      if (keyRef.current === e2eKey) remember(entries)
    })
  }, [e2eKey, rows, rawSpace, rawMembers, plain, spaceId])

  // What the screens see: rows with their plaintext filled in.
  const view = useMemo(() => {
    let decrypting = false
    function read<T>(cipher: string | null | undefined, context: string, fallback: () => T): T | null {
      if (!cipher) return fallback()
      const v = plain.get(cacheKey(context, cipher))
      if (v === undefined) {
        decrypting = true
        return null
      }
      return v === FAILED ? null : (v as T)
    }

    const contacts: Contact[] = rows.contacts
      .flatMap((r) => {
        const c = read(r.cipher, contexts.contact(spaceId, r.id), () => legacy.contact(r))
        return c
          ? [{ ...c, id: r.id, space_id: r.space_id, created_by: r.created_by, created_at: r.created_at, updated_at: r.updated_at }]
          : []
      })
      .sort(byName)

    const notes: Note[] = rows.notes
      .flatMap((r) => {
        const n = read(r.cipher, contexts.note(spaceId, r.id), () => legacy.note(r))
        return n
          ? [{ ...n, id: r.id, space_id: r.space_id, created_by: r.created_by, created_at: r.created_at, updated_at: r.updated_at }]
          : []
      })
      .sort(notesOrder)

    const lists: List[] = rows.lists.flatMap((r) => {
      const l = read(r.cipher, contexts.list(spaceId, r.id), () => legacy.list(r))
      return l ? [{ ...l, id: r.id, space_id: r.space_id, created_by: r.created_by, created_at: r.created_at }] : []
    })

    const list_items: ListItem[] = rows.list_items.flatMap((r) => {
      const i = read(r.cipher, contexts.item(spaceId, r.list_id, r.id), () => legacy.item(r))
      return i
        ? [{ ...i, id: r.id, space_id: r.space_id, list_id: r.list_id, created_by: r.created_by, created_at: r.created_at }]
        : []
    })

    const messages: Message[] = rows.messages.map((r) => {
      const base = {
        id: r.id,
        space_id: r.space_id,
        sender_id: r.sender_id,
        created_at: r.created_at,
        has_media: r.has_media ?? false,
        media_opened_at: r.media_opened_at ?? null,
        pending: r.pending,
      }
      if (!r.cipher) return { ...base, body: r.body ?? null, contact: r.contact ?? null, media: null }
      const v = plain.get(cacheKey(contexts.message({ spaceId, senderId: r.sender_id, messageId: r.id }), r.cipher))
      if (v === undefined) return { ...base, body: null, contact: null, media: null, locked: true }
      if (v === FAILED) return { ...base, body: null, contact: null, media: null, undecryptable: true }
      const content = v as MessageContent
      return { ...base, body: content.body, contact: content.contact, media: content.media ?? null }
    })

    const space: Space | null = rawSpace && {
      ...rawSpace,
      name: read(rawSpace.name_cipher, contexts.spaceName(spaceId), () => rawSpace.name),
    }
    const members: Member[] = rawMembers.map((m) => ({
      ...m,
      display_name: read(m.display_name_cipher, contexts.memberName(spaceId, m.user_id), () => m.display_name),
    }))

    // Plaintext rows this device can encrypt. The partner's own name and
    // messages are theirs to upgrade, on their phone.
    const mine = rawMembers.find((m) => m.user_id === userId)
    const legacyRows =
      rows.contacts.filter((r) => !r.cipher).length +
      rows.notes.filter((r) => !r.cipher).length +
      rows.lists.filter((r) => !r.cipher).length +
      rows.list_items.filter((r) => !r.cipher).length +
      rows.messages.filter((r) => !r.cipher && r.sender_id === userId && !r.pending).length +
      (rawSpace && !rawSpace.name_cipher && rawSpace.name !== null ? 1 : 0) +
      (mine && !mine.display_name_cipher && mine.display_name !== null ? 1 : 0)

    return { contacts, notes, lists, list_items, messages, space, members, decrypting, legacyRows }
  }, [rows, plain, rawSpace, rawMembers, spaceId, userId])

  const viewRef = useRef(view)
  viewRef.current = view

  // ─── Actions ─────────────────────────────────────────────────────────

  const actions = useMemo(() => {
    const upsert = (table: Table, row: AnyRow) => dispatch({ type: 'upsert', table, row })
    const remove = (table: Table, id: string) => dispatch({ type: 'remove', table, id })
    const now = () => new Date().toISOString()
    const media = () => supabase.storage.from(MEDIA_BUCKET)

    function requireKey(): CryptoKey {
      const key = keyRef.current
      if (!key) throw new Error('Unlock Duo first.')
      return key
    }

    /** Encrypts `content` and remembers its plaintext, so it shows right away. */
    async function seal(context: string, content: unknown): Promise<string> {
      const cipher = await encryptRecord(requireKey(), context, content)
      remember([[cacheKey(context, cipher), content]])
      return cipher
    }

    async function insertSealed<T extends AnyRow>(table: Table, row: Record<string, unknown>): Promise<T> {
      const saved = await must<T>(supabase.from(table).insert({ ...row, space_id: spaceId }).select().single())
      upsert(table, saved)
      return saved
    }

    /** Replaces a row's ciphertext right away, then on the server; rolls back if that fails. */
    async function updateSealed(table: Exclude<Table, 'messages'>, id: string, cipher: string) {
      const before = (rowsRef.current[table] as AnyRow[]).find((r) => r.id === id)
      const values = { ...CLEARED[table], cipher }
      if (before) upsert(table, { ...before, ...values })
      try {
        upsert(table, await must<AnyRow>(supabase.from(table).update(values).eq('id', id).select().single()))
      } catch (e) {
        if (before) upsert(table, before)
        throw e
      }
    }

    async function del(table: Table, id: string) {
      await must(supabase.from(table).delete().eq('id', id))
      remove(table, id)
    }

    function current<T extends { id: string }>(list: T[], id: string): T {
      const found = list.find((x) => x.id === id)
      if (!found) throw new Error('That was deleted, or is still unlocking.')
      return found
    }

    /** Encrypts and sends a message. `beforeInsert` runs once its id is known (to upload a file). */
    async function sendContent(
      content: MessageContent,
      extra: Record<string, unknown> = {},
      beforeInsert?: (id: string, ids: MessageIds) => Promise<void>,
    ) {
      const key = requireKey()
      // The id is chosen here so it can be sealed into the ciphertext.
      const id = crypto.randomUUID()
      const ids: MessageIds = { spaceId, senderId: userId, messageId: id }
      const cipher = await encryptMessage(key, ids, content)
      remember([[cacheKey(contexts.message(ids), cipher), content]])
      const temp: StoredMessage = { id, space_id: spaceId, sender_id: userId, created_at: now(), cipher, pending: true, ...extra }
      upsert('messages', temp)
      try {
        await beforeInsert?.(id, ids)
        const row = await must<StoredMessage>(supabase.from('messages').insert({ id, space_id: spaceId, cipher, ...extra }).select().single())
        dispatch({ type: 'confirm', table: 'messages', tempId: id, row })
      } catch (e) {
        remove('messages', id)
        throw e
      }
    }

    async function renameSpace(name: string) {
      const cipher = await seal(contexts.spaceName(spaceId), name)
      setRawSpace(await must<StoredSpace>(supabase.from('spaces').update({ name_cipher: cipher, name: null }).eq('id', spaceId).select().single()))
    }

    async function renameMe(name: string) {
      const cipher = await seal(contexts.memberName(spaceId, userId), name)
      await must(supabase.from('members').update({ display_name_cipher: cipher, display_name: null }).eq('user_id', userId))
      setRawMembers((ms) => ms.map((m) => (m.user_id === userId ? { ...m, display_name_cipher: cipher, display_name: null } : m)))
    }

    function contactContent(c: ContactContent): ContactContent {
      return {
        full_name: c.full_name,
        phones: c.phones,
        emails: c.emails,
        company: c.company,
        address: c.address,
        birthday: c.birthday,
        notes: c.notes,
        tags: c.tags,
        favorite: c.favorite,
      }
    }

    return {
      // ── Chat ──
      sendMessage(input: { body?: string; contact?: ContactCard }) {
        return sendContent({ body: input.body?.trim() || null, contact: input.contact ? toCard(input.contact) : null, media: null })
      },

      /** Sends a view-once photo or video: encrypted here, uploaded, deleted once opened. */
      async sendMedia(file: File) {
        const { bytes, info } = await prepareMedia(file)
        const key = requireKey()
        const uploaded = { path: '' }
        try {
          await sendContent({ body: null, contact: null, media: info }, { has_media: true }, async (id, ids) => {
            const encrypted = await encryptBytes(key, contexts.media(ids), bytes)
            const path = mediaPath(spaceId, id)
            const { error } = await media().upload(path, new Blob([encrypted], { type: 'application/octet-stream' }), {
              contentType: 'application/octet-stream',
              upsert: false,
            })
            if (error) throw new Error(error.message)
            uploaded.path = path
          })
        } catch (e) {
          // Don't leave an encrypted file behind for a message that was never saved.
          if (uploaded.path) await media().remove([uploaded.path]).catch(() => {})
          throw e
        }
      },

      /** Downloads and decrypts a photo or video; returns a URL that only works on this page. */
      async openMedia(m: Message): Promise<string> {
        const key = requireKey()
        const { data, error } = await media().download(mediaPath(spaceId, m.id))
        if (error || !data) throw new Error('This was already opened, or it expired.')
        const ids = { spaceId, senderId: m.sender_id, messageId: m.id }
        const bytes = await decryptBytes(key, contexts.media(ids), await data.arrayBuffer())
        return URL.createObjectURL(new Blob([bytes], { type: m.media?.mime ?? 'application/octet-stream' }))
      },

      /** Marks a photo or video opened and deletes its file. */
      async finishMedia(m: Message) {
        await must(supabase.rpc('mark_media_opened', { message_id: m.id }))
        const row = rowsRef.current.messages.find((r) => r.id === m.id)
        if (row) upsert('messages', { ...row, media_opened_at: now() } as AnyRow)
        await media().remove([mediaPath(spaceId, m.id)])
      },

      /** Deletes files that were opened or expired, or whose message is gone. */
      async sweepMedia(): Promise<number> {
        const { data } = await media().list(spaceId, { limit: 1000 })
        const stale = (data ?? [])
          .filter((obj) => {
            const m = rowsRef.current.messages.find((r) => r.id === obj.name)
            if (!m) return obj.created_at ? isExpired(obj.created_at) : false
            return Boolean(m.media_opened_at) || isExpired(m.created_at)
          })
          .map((obj) => mediaPath(spaceId, obj.name))
        if (stale.length) await media().remove(stale)
        return stale.length
      },

      async deleteMessage(id: string) {
        const row = rowsRef.current.messages.find((r) => r.id === id)
        await del('messages', id)
        if (row?.has_media) await media().remove([mediaPath(spaceId, id)])
      },

      // ── Contacts ──
      async addContact(input: ContactInput): Promise<Contact> {
        const id = crypto.randomUUID()
        const content = contactContent(input)
        const row = await insertSealed<StoredContact>('contacts', { id, cipher: await seal(contexts.contact(spaceId, id), content) })
        return { ...content, id, space_id: spaceId, created_by: userId, created_at: row.created_at, updated_at: row.updated_at }
      },
      async updateContact(id: string, patch: Partial<ContactInput>): Promise<Contact> {
        const next = { ...current(viewRef.current.contacts, id), ...patch }
        await updateSealed('contacts', id, await seal(contexts.contact(spaceId, id), contactContent(next)))
        return next
      },
      deleteContact: (id: string) => del('contacts', id),
      async importContacts(cards: ContactCard[]): Promise<number> {
        let added = 0
        for (let i = 0; i < cards.length; i += 200) {
          const batch = await Promise.all(
            cards.slice(i, i + 200).map(async (c) => {
              const id = crypto.randomUUID()
              const content: ContactContent = { ...toCard(c), tags: [], favorite: false }
              return { id, space_id: spaceId, cipher: await seal(contexts.contact(spaceId, id), content) }
            }),
          )
          const inserted = await must<StoredContact[]>(supabase.from('contacts').insert(batch).select())
          inserted.forEach((r) => upsert('contacts', r))
          added += inserted.length
        }
        return added
      },

      // ── Notes ──
      async addNote(input: NoteContent): Promise<Note> {
        const id = crypto.randomUUID()
        const content: NoteContent = { title: input.title, body: input.body, pinned: input.pinned }
        const row = await insertSealed<StoredNote>('notes', { id, cipher: await seal(contexts.note(spaceId, id), content) })
        return { ...content, id, space_id: spaceId, created_by: userId, created_at: row.created_at, updated_at: row.updated_at }
      },
      async updateNote(id: string, patch: Partial<NoteContent>) {
        const n = { ...current(viewRef.current.notes, id), ...patch }
        await updateSealed('notes', id, await seal(contexts.note(spaceId, id), { title: n.title, body: n.body, pinned: n.pinned }))
      },
      deleteNote: (id: string) => del('notes', id),

      // ── Lists ──
      async addList(input: ListContent): Promise<List> {
        const id = crypto.randomUUID()
        const content: ListContent = { title: input.title, emoji: input.emoji }
        const row = await insertSealed<StoredList>('lists', { id, cipher: await seal(contexts.list(spaceId, id), content) })
        return { ...content, id, space_id: spaceId, created_by: userId, created_at: row.created_at }
      },
      async updateList(id: string, patch: Partial<ListContent>): Promise<List> {
        const l = { ...current(viewRef.current.lists, id), ...patch }
        await updateSealed('lists', id, await seal(contexts.list(spaceId, id), { title: l.title, emoji: l.emoji }))
        return l
      },
      deleteList: (id: string) => del('lists', id),

      async addItem(listId: string, text: string) {
        const id = crypto.randomUUID()
        const content: ItemContent = { text: text.trim(), done: false, due_date: null }
        await insertSealed('list_items', { id, list_id: listId, cipher: await seal(contexts.item(spaceId, listId, id), content) })
      },
      async updateItem(id: string, patch: Partial<ItemContent>) {
        const i = { ...current(viewRef.current.list_items, id), ...patch }
        const content: ItemContent = { text: i.text, done: i.done, due_date: i.due_date }
        await updateSealed('list_items', id, await seal(contexts.item(spaceId, i.list_id, id), content))
      },
      deleteItem: (id: string) => del('list_items', id),
      async clearDone(listId: string) {
        // The server can't see which items are done, so the ids come from here.
        const done = viewRef.current.list_items.filter((i) => i.list_id === listId && i.done).map((i) => i.id)
        if (!done.length) return
        await must(supabase.from('list_items').delete().in('id', done))
        done.forEach((id) => remove('list_items', id))
      },

      // ── Names ──
      renameSpace,
      renameMe,

      // ── Encryption ──
      /** Turns on end-to-end encryption for the space, with a passphrase you both know. */
      async setUpEncryption(passphrase: string) {
        const salt = newSalt()
        const key = await deriveKey(passphrase, salt)
        const check = await makeCheck(key, spaceId)
        await must(supabase.rpc('enable_e2e', { salt, check_value: check }))
        setRawSpace((s) => s && { ...s, e2e_salt: salt, e2e_check: check })
        await keystore.set(spaceId, key).catch(() => {})
        keyRef.current = key // so actions right after this can use it
        setE2eKey(key)
      },

      /** Unlocks this device with the passphrase. Throws if it's not the right one. */
      async unlockEncryption(passphrase: string) {
        const s = rawSpaceRef.current
        if (!s?.e2e_salt || !s.e2e_check) throw new Error('Encryption is not set up yet.')
        const key = await deriveKey(passphrase, s.e2e_salt)
        if (!(await keyMatches(key, spaceId, s.e2e_check))) throw new Error('That passphrase does not match.')
        await keystore.set(spaceId, key).catch(() => {})
        keyRef.current = key
        setE2eKey(key)
      },

      /** Forgets the key on this device; everything stays encrypted until it's unlocked again. */
      async lockDevice() {
        await keystore.remove(spaceId).catch(() => {})
        keyRef.current = null
        setE2eKey(null)
        setPlain(new Map())
      },

      /**
       * Encrypts anything saved before encryption was on: the space name, your
       * own name and messages, and every contact, note and list. Returns how
       * many rows were upgraded.
       */
      async upgradeLegacy(): Promise<number> {
        const key = requireKey()
        let count = 0
        const s = rawSpaceRef.current
        if (s && !s.name_cipher && s.name !== null) {
          await renameSpace(s.name)
          count++
        }
        const me = rawMembersRef.current.find((m) => m.user_id === userId)
        if (me && !me.display_name_cipher && me.display_name !== null) {
          await renameMe(me.display_name)
          count++
        }
        const r = rowsRef.current
        for (const c of r.contacts.filter((x) => !x.cipher)) {
          await updateSealed('contacts', c.id, await seal(contexts.contact(spaceId, c.id), legacy.contact(c)))
          count++
        }
        for (const n of r.notes.filter((x) => !x.cipher)) {
          await updateSealed('notes', n.id, await seal(contexts.note(spaceId, n.id), legacy.note(n)))
          count++
        }
        for (const l of r.lists.filter((x) => !x.cipher)) {
          await updateSealed('lists', l.id, await seal(contexts.list(spaceId, l.id), legacy.list(l)))
          count++
        }
        for (const i of r.list_items.filter((x) => !x.cipher)) {
          await updateSealed('list_items', i.id, await seal(contexts.item(spaceId, i.list_id, i.id), legacy.item(i)))
          count++
        }
        // Messages can't be edited, so each of ours is swapped for an encrypted
        // copy in one server-side step.
        for (const m of r.messages.filter((x) => !x.cipher && x.sender_id === userId && !x.pending)) {
          const newId = crypto.randomUUID()
          const ids = { spaceId, senderId: userId, messageId: newId }
          const content: MessageContent = { body: m.body ?? null, contact: m.contact ?? null, media: null }
          const cipher = await encryptMessage(key, ids, content)
          remember([[cacheKey(contexts.message(ids), cipher), content]])
          await must(supabase.rpc('encrypt_legacy_message', { old_id: m.id, new_id: newId, new_cipher: cipher }))
          const replacement: StoredMessage = { ...m, id: newId, cipher, body: null, contact: null }
          dispatch({ type: 'confirm', table: 'messages', tempId: m.id, row: replacement })
          count++
        }
        return count
      },

      /** Throttled "is typing" ping to the other person. */
      typing() {
        const t = Date.now()
        if (t - lastTypingSent.current < 2500) return
        lastTypingSent.current = t
        void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId } })
      },
    }
  }, [spaceId, userId])

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
    decrypting: Boolean(e2eKey) && view.decrypting,
    /** Rows from before encryption that this device can encrypt. */
    legacyRows: view.legacyRows,
    e2e: {
      /** Turned on for the space; once on, it stays on. */
      enabled: Boolean(rawSpace?.e2e_salt),
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
  return (id: string | null) =>
    id === userId ? 'you' : (members.find((m) => m.user_id === id)?.display_name ?? 'your person')
}
