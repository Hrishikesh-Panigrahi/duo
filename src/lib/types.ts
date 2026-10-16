import type { ContactCard } from './vcard'

// What's stored (ciphertext plus the ids and timestamps the server needs), and what the app works with
// once a row is decrypted on the phone.

// ─── What's inside each ciphertext ─────────────────────────────────────

export type ContactContent = Required<ContactCard> & { tags: string[]; favorite: boolean }
export type NoteContent = { title: string; body: string; pinned: boolean }
export type ListContent = { title: string; emoji: string | null }
export type ItemContent = { text: string; done: boolean; due_date: string | null }

export type MediaInfo = {
  kind: 'image' | 'video'
  mime: string
  /** Bytes, before encryption. */
  size: number
  width?: number
  height?: number
}

// ─── Stored rows ───────────────────────────────────────────────────────

type Stored = { id: string; space_id: string; cipher: string | null; created_at: string }

export type StoredSpace = {
  id: string
  invite_code: string | null
  created_at: string
  e2e_salt: string | null
  e2e_check: string | null
  name_cipher: string | null
  /** Plaintext from before encryption. */
  name: string | null
}

export type StoredMember = {
  space_id: string
  user_id: string
  joined_at: string
  display_name_cipher: string | null
  /** Plaintext from before encryption. */
  display_name: string | null
}

export type StoredContact = Stored & Partial<ContactContent> & { created_by: string | null; updated_at: string }
export type StoredNote = Stored & Partial<NoteContent> & { created_by: string | null; updated_at: string }
export type StoredList = Stored & Partial<ListContent> & { created_by: string | null }
export type StoredItem = Stored & Partial<ItemContent> & { list_id: string; created_by: string | null }
export type StoredMessage = Stored & {
  sender_id: string
  /** Plaintext from before encryption. */
  body?: string | null
  contact?: ContactCard | null
  has_media?: boolean
  media_opened_at?: string | null
  /** Sent straight to the other phone, so there's no copy in Storage. */
  media_direct?: boolean
  /** Client-only: shown before the server confirms. */
  pending?: boolean
}

// ─── What the app works with ───────────────────────────────────────────

export type Space = Omit<StoredSpace, 'name'> & { name: string | null }
export type Member = Omit<StoredMember, 'display_name'> & { display_name: string | null }

export type Contact = ContactContent & {
  id: string
  space_id: string
  created_by: string | null
  created_at: string
  updated_at: string
}
export type ContactInput = ContactContent

export type Note = NoteContent & { id: string; space_id: string; created_by: string | null; created_at: string; updated_at: string }
export type List = ListContent & { id: string; space_id: string; created_by: string | null; created_at: string }
export type ListItem = ItemContent & { id: string; space_id: string; list_id: string; created_by: string | null; created_at: string }

export type Message = {
  id: string
  space_id: string
  sender_id: string
  created_at: string
  body: string | null
  contact: ContactCard | null
  media: MediaInfo | null
  has_media: boolean
  media_opened_at: string | null
  media_direct: boolean
  pending?: boolean
  /** Encrypted, and this device can't read it yet. */
  locked?: boolean
  /** Encrypted, and decrypting it failed. */
  undecryptable?: boolean
}

/** Just the card fields, with every optional field filled in. */
export function toCard(c: ContactCard): Required<ContactCard> {
  return {
    full_name: c.full_name,
    phones: c.phones,
    emails: c.emails,
    company: c.company ?? null,
    address: c.address ?? null,
    birthday: c.birthday ?? null,
    notes: c.notes ?? null,
  }
}
