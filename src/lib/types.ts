import type { ContactCard } from './vcard'

export type Space = {
  id: string
  name: string
  invite_code: string | null
  created_at: string
  /** Set once end-to-end encryption is turned on for the space. */
  e2e_salt: string | null
  e2e_check: string | null
}

export type Member = { space_id: string; user_id: string; display_name: string; joined_at: string }

export type Contact = Required<ContactCard> & {
  id: string
  space_id: string
  tags: string[]
  favorite: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ContactInput = Omit<Contact, 'id' | 'space_id' | 'created_by' | 'created_at' | 'updated_at'>

export type Message = {
  id: string
  space_id: string
  sender_id: string
  body: string | null
  contact: ContactCard | null
  /** End-to-end encrypted body and contact; the server never sees them in the clear. */
  cipher?: string | null
  created_at: string
  /** Client-only: shown before the server confirms. */
  pending?: boolean
  /** Client-only: encrypted, and this device can't read it yet (no key, or still decrypting). */
  locked?: boolean
  /** Client-only: encrypted, and decrypting it failed. */
  undecryptable?: boolean
}

export type Note = {
  id: string
  space_id: string
  title: string
  body: string
  pinned: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type List = {
  id: string
  space_id: string
  title: string
  emoji: string | null
  created_by: string | null
  created_at: string
}

export type ListItem = {
  id: string
  space_id: string
  list_id: string
  text: string
  done: boolean
  due_date: string | null
  created_by: string | null
  created_at: string
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
