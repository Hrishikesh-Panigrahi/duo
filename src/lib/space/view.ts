// What the screens see: stored rows with their plaintext filled in from a
// cache of what this device has decrypted. Plain functions, no React, so they
// can be tested on their own.
import {
  contexts,
  decryptMessage,
  decryptRecord,
  type MessageContent,
  type MessageIds,
} from '../e2e'
import type { Contact, List, ListItem, Member, Message, Note, Space, StoredMember, StoredSpace } from '../types'
import { legacy, time, type Rows } from './rows'

/** Plaintext by context + ciphertext; FAILED marks something that wouldn't decrypt. */
export type PlainCache = ReadonlyMap<string, unknown>
export const FAILED = Symbol('decryption failed')
export const cacheKey = (context: string, cipher: string) => `${context}|${cipher}`

export type ViewInput = {
  spaceId: string
  rows: Rows
  space: StoredSpace | null
  members: StoredMember[]
  plain: PlainCache
}

const byName = (a: Contact, b: Contact) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })
const notesOrder = (a: Note, b: Note) => Number(b.pinned) - Number(a.pinned) || time(b.updated_at) - time(a.updated_at)

export function deriveView({ spaceId, rows, space: rawSpace, members: rawMembers, plain }: ViewInput) {
  let decrypting = false
  // Before encryption is on there's nothing to protect, so older rows show
  // as they are (and the setup screen can offer the old names). Once it's on,
  // a row without ciphertext can only have been written around the app, so
  // it's never shown.
  const encrypted = Boolean(rawSpace?.e2e_salt)
  function read<T>(cipher: string | null | undefined, context: string, fallback: () => T): T | null {
    if (!cipher) return encrypted ? null : fallback()
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

  const messages: Message[] = rows.messages.flatMap((r): Message[] | Message => {
    const base = {
      id: r.id,
      space_id: r.space_id,
      sender_id: r.sender_id,
      created_at: r.created_at,
      has_media: r.has_media ?? false,
      media_opened_at: r.media_opened_at ?? null,
      media_direct: r.media_direct ?? false,
      pending: r.pending,
    }
    if (!r.cipher) return encrypted ? [] : { ...base, body: r.body ?? null, contact: r.contact ?? null, media: null }
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

  return { contacts, notes, lists, list_items, messages, space, members, decrypting }
}

export type SpaceView = ReturnType<typeof deriveView>

export type Decryption = { key: string; run: () => Promise<unknown> }

/** Everything that has ciphertext this device hasn't decrypted (or started to) yet. */
export function pendingDecryptions(
  key: CryptoKey,
  { spaceId, rows, space, members }: Omit<ViewInput, 'plain'>,
  known: (cacheKey: string) => boolean,
): Decryption[] {
  const jobs: Decryption[] = []
  const add = (context: string, cipher: string | null | undefined, run: (c: string) => Promise<unknown>) => {
    if (!cipher) return
    const k = cacheKey(context, cipher)
    if (known(k)) return
    jobs.push({ key: k, run: () => run(cipher) })
  }
  const addRecord = (context: string, cipher: string | null | undefined) =>
    add(context, cipher, (c) => decryptRecord(key, context, c))

  for (const r of rows.contacts) addRecord(contexts.contact(spaceId, r.id), r.cipher)
  for (const r of rows.notes) addRecord(contexts.note(spaceId, r.id), r.cipher)
  for (const r of rows.lists) addRecord(contexts.list(spaceId, r.id), r.cipher)
  for (const r of rows.list_items) addRecord(contexts.item(spaceId, r.list_id, r.id), r.cipher)
  for (const r of rows.messages) {
    const ids: MessageIds = { spaceId, senderId: r.sender_id, messageId: r.id }
    add(contexts.message(ids), r.cipher, (c) => decryptMessage(key, ids, c))
  }
  if (space) addRecord(contexts.spaceName(spaceId), space.name_cipher)
  for (const m of members) addRecord(contexts.memberName(spaceId, m.user_id), m.display_name_cipher)
  return jobs
}
