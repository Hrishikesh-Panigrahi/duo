import type { ContactCard } from './vcard'

export type Space = { id: string; name: string; invite_code: string | null; created_at: string }

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
  created_at: string
  /** Client-only: shown before the server confirms. */
  pending?: boolean
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
