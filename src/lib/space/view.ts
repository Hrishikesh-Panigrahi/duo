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
import { shapes } from './shapes'

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

const STORED_FIELDS = ['id', 'space_id', 'created_by', 'created_at'] as const

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

/** Contacts A to Z, ignoring case and accents. */
function byName(a: Contact, b: Contact): number {
  return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })
}

function pinnedThenNewest(a: Note, b: Note): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return Date.parse(b.updated_at) - Date.parse(a.updated_at)
}

class PlainReader {
  decrypting = false

  // Once encryption is on, a row without ciphertext can only have been written around the app.
  constructor(
    private readonly plain: PlainCache,
    private readonly encryptionOn: boolean,
  ) {}

  read<T>(cipher: string | null | undefined, context: string, readLegacy: () => T): T | null {
    if (!cipher) return this.encryptionOn ? null : readLegacy()
    const plaintext = this.plain.get(cacheKey(context, cipher))
    if (plaintext === undefined) {
      this.decrypting = true
      return null
    }
    if (plaintext === FAILED) return null
    return plaintext as T
  }

  /** Each readable row's content, plus the stored fields named in `storedFields`. */
  readRows<R extends { cipher: string | null }, C, K extends keyof R>(
    rows: R[],
    contextOf: (row: R) => string,
    readLegacy: (row: R) => C,
    storedFields: readonly K[],
  ): (C & Pick<R, K>)[] {
    const readable: (C & Pick<R, K>)[] = []
    for (const row of rows) {
      const content = this.read(row.cipher, contextOf(row), () => readLegacy(row))
      if (!content) continue
      const stored = {} as Pick<R, K>
      for (const field of storedFields) stored[field] = row[field]
      readable.push({ ...content, ...stored })
    }
    return readable
  }

  message(row: StoredMessage, spaceId: string): Message | null {
    const base = {
      id: row.id,
      space_id: row.space_id,
      sender_id: row.sender_id,
      created_at: row.created_at,
      has_media: row.has_media ?? false,
      media_opened_at: row.media_opened_at ?? null,
      media_direct: row.media_direct ?? false,
      pending: row.pending,
    }
    if (!row.cipher) return this.encryptionOn ? null : { ...base, body: row.body ?? null, contact: row.contact ?? null, media: null }
    const plaintext = this.plain.get(cacheKey(contexts.message({ spaceId, senderId: row.sender_id, messageId: row.id }), row.cipher))
    if (plaintext === undefined) return { ...base, body: null, contact: null, media: null, locked: true }
    if (plaintext === FAILED) return { ...base, body: null, contact: null, media: null, undecryptable: true }
    const content = plaintext as MessageContent
    return { ...base, body: content.body, contact: content.contact, media: content.media ?? null }
  }
}

export function deriveView({ spaceId, rows, space, members, plain }: ViewInput): SpaceView {
  const reader = new PlainReader(plain, Boolean(space?.e2e_salt))
  const contacts = reader.readRows(rows.contacts, (r) => contexts.contact(spaceId, r.id), legacy.contact, [...STORED_FIELDS, 'updated_at'])
  const notes = reader.readRows(rows.notes, (r) => contexts.note(spaceId, r.id), legacy.note, [...STORED_FIELDS, 'updated_at'])
  const view = {
    contacts: contacts.sort(byName),
    notes: notes.sort(pinnedThenNewest),
    lists: reader.readRows(rows.lists, (r) => contexts.list(spaceId, r.id), legacy.list, STORED_FIELDS),
    list_items: reader.readRows(rows.list_items, (r) => contexts.item(spaceId, r.list_id, r.id), legacy.item, [...STORED_FIELDS, 'list_id']),
    messages: rows.messages.flatMap((r) => reader.message(r, spaceId) ?? []),
    space: space && { ...space, name: reader.read(space.name_cipher, contexts.spaceName(spaceId), () => space.name) },
    members: members.map((m) => {
      const display_name = reader.read(m.display_name_cipher, contexts.memberName(spaceId, m.user_id), () => m.display_name)
      return { ...m, display_name }
    }),
  }
  return { ...view, decrypting: reader.decrypting }
}

export type DecryptionJob = { cacheKey: string; decrypt: () => Promise<unknown> }

/** Anything that decrypts but isn't the shape it should be counts as undecryptable. */
function checkedJob(entryKey: string, decrypt: () => Promise<unknown>, valid: (v: unknown) => boolean): DecryptionJob {
  return {
    cacheKey: entryKey,
    decrypt: async () => {
      const value = await decrypt()
      if (!valid(value)) throw new Error('Not the expected shape')
      return value
    },
  }
}

/** Everything that has ciphertext this device hasn't decrypted (or started to) yet. */
export function pendingDecryptions(
  key: CryptoKey,
  { spaceId, rows, space, members }: Omit<ViewInput, 'plain'>,
  isDoneOrInFlight: (cacheKey: string) => boolean,
): DecryptionJob[] {
  const jobs: DecryptionJob[] = []
  const addJob = (context: string, cipher: string | null | undefined, valid: (v: unknown) => boolean, decrypt: (c: string) => Promise<unknown>) => {
    if (!cipher) return
    const entryKey = cacheKey(context, cipher)
    if (!isDoneOrInFlight(entryKey)) jobs.push(checkedJob(entryKey, () => decrypt(cipher), valid))
  }
  const addRecordJob = (context: string, cipher: string | null | undefined, valid: (v: unknown) => boolean) =>
    addJob(context, cipher, valid, (c) => decryptRecord(key, context, c))

  for (const row of rows.contacts) addRecordJob(contexts.contact(spaceId, row.id), row.cipher, shapes.contact)
  for (const row of rows.notes) addRecordJob(contexts.note(spaceId, row.id), row.cipher, shapes.note)
  for (const row of rows.lists) addRecordJob(contexts.list(spaceId, row.id), row.cipher, shapes.list)
  for (const row of rows.list_items) addRecordJob(contexts.item(spaceId, row.list_id, row.id), row.cipher, shapes.item)
  for (const row of rows.messages) {
    const ids: MessageIds = { spaceId, senderId: row.sender_id, messageId: row.id }
    addJob(contexts.message(ids), row.cipher, shapes.message, (c) => decryptMessage(key, ids, c))
  }
  if (space) addRecordJob(contexts.spaceName(spaceId), space.name_cipher, shapes.name)
  for (const member of members) addRecordJob(contexts.memberName(spaceId, member.user_id), member.display_name_cipher, shapes.name)
  return jobs
}
