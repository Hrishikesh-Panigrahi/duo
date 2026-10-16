// What the screens see: stored rows with their plaintext filled in from what this device has decrypted.
import {
  contexts,
  decryptMessage,
  decryptRecord,
  type MessageContent,
  type MessageIds,
} from '../e2e'
import type { Contact, List, ListItem, Member, Message, Note, Space, StoredMember, StoredMessage, StoredSpace } from '../types'
import { legacy, type Rows } from './rows'

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

const OWNED = ['id', 'space_id', 'created_by', 'created_at'] as const

export type SpaceView = {
  contacts: Contact[]
  notes: Note[]
  lists: List[]
  list_items: ListItem[]
  messages: Message[]
  space: Space | null
  members: Member[]
  /** Something has ciphertext this device hasn't decrypted yet. */
  decrypting: boolean
}

class PlainReader {
  decrypting = false

  // Once encryption is on, a row without ciphertext can only have been written around the app.
  constructor(
    private readonly plain: PlainCache,
    private readonly encrypted: boolean,
  ) {}

  read<T>(cipher: string | null | undefined, context: string, fallback: () => T): T | null {
    if (!cipher) return this.encrypted ? null : fallback()
    const v = this.plain.get(cacheKey(context, cipher))
    if (v === undefined) this.decrypting = true
    return v === undefined || v === FAILED ? null : (v as T)
  }

  /** Each readable row's content, plus the stored fields named in `keep`. */
  rows<R extends { cipher: string | null }, C, K extends keyof R>(rows: R[], context: (r: R) => string, old: (r: R) => C, keep: readonly K[]) {
    return rows.flatMap((r) => {
      const content = this.read(r.cipher, context(r), () => old(r))
      if (!content) return []
      return [{ ...content, ...(Object.fromEntries(keep.map((k) => [k, r[k]])) as Pick<R, K>) }]
    })
  }

  message(r: StoredMessage, spaceId: string): Message | null {
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
    if (!r.cipher) return this.encrypted ? null : { ...base, body: r.body ?? null, contact: r.contact ?? null, media: null }
    const v = this.plain.get(cacheKey(contexts.message({ spaceId, senderId: r.sender_id, messageId: r.id }), r.cipher))
    if (v === undefined) return { ...base, body: null, contact: null, media: null, locked: true }
    if (v === FAILED) return { ...base, body: null, contact: null, media: null, undecryptable: true }
    const content = v as MessageContent
    return { ...base, body: content.body, contact: content.contact, media: content.media ?? null }
  }
}

export function deriveView({ spaceId, rows, space, members, plain }: ViewInput): SpaceView {
  const reader = new PlainReader(plain, Boolean(space?.e2e_salt))
  const contacts = reader.rows(rows.contacts, (r) => contexts.contact(spaceId, r.id), legacy.contact, [...OWNED, 'updated_at'])
  const notes = reader.rows(rows.notes, (r) => contexts.note(spaceId, r.id), legacy.note, [...OWNED, 'updated_at'])
  const view = {
    contacts: contacts.sort((a, b) => a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })),
    notes: notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updated_at) - Date.parse(a.updated_at)),
    lists: reader.rows(rows.lists, (r) => contexts.list(spaceId, r.id), legacy.list, OWNED),
    list_items: reader.rows(rows.list_items, (r) => contexts.item(spaceId, r.list_id, r.id), legacy.item, [...OWNED, 'list_id']),
    messages: rows.messages.flatMap((r) => reader.message(r, spaceId) ?? []),
    space: space && { ...space, name: reader.read(space.name_cipher, contexts.spaceName(spaceId), () => space.name) },
    members: members.map((m) => {
      const display_name = reader.read(m.display_name_cipher, contexts.memberName(spaceId, m.user_id), () => m.display_name)
      return { ...m, display_name }
    }),
  }
  return { ...view, decrypting: reader.decrypting }
}

export type Decryption = { key: string; run: () => Promise<unknown> }

/** Everything that has ciphertext this device hasn't decrypted (or started to) yet. */
export function pendingDecryptions(
  key: CryptoKey,
  { spaceId, rows, space, members }: Omit<ViewInput, 'plain'>,
  known: (cacheKey: string) => boolean,
): Decryption[] {
  const jobs: Decryption[] = []
  const add = (context: string, cipher: string | null | undefined, run: (c: string) => Promise<unknown>) => {
    if (!cipher || known(cacheKey(context, cipher))) return
    jobs.push({ key: cacheKey(context, cipher), run: () => run(cipher) })
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
