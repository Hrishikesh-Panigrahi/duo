// Contacts, notes, lists and the names: all encrypted on this device before
// they're saved, with plaintext remembered so changes show straight away.
import { contexts } from '../e2e'
import { must, supabase } from '../supabase'
import {
  toCard,
  type Contact,
  type ContactContent,
  type ContactInput,
  type ItemContent,
  type List,
  type ListContent,
  type Note,
  type NoteContent,
  type StoredContact,
  type StoredList,
  type StoredNote,
  type StoredSpace,
} from '../types'
import type { ContactCard } from '../vcard'
import type { Records, StoreDeps } from './records'

/** Just the fields that are encrypted, in a fixed shape. */
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

export function contentActions(d: StoreDeps, r: Records) {
  const { spaceId, userId } = d

  return {
    // ── Contacts ──
    async addContact(input: ContactInput): Promise<Contact> {
      const id = crypto.randomUUID()
      const content = contactContent(input)
      const row = await r.insertSealed<StoredContact>('contacts', { id, cipher: await r.seal(contexts.contact(spaceId, id), content) })
      return { ...content, id, space_id: spaceId, created_by: userId, created_at: row.created_at, updated_at: row.updated_at }
    },
    async updateContact(id: string, patch: Partial<ContactInput>): Promise<Contact> {
      const next = { ...r.current(d.view.current.contacts, id), ...patch }
      await r.updateSealed('contacts', id, await r.seal(contexts.contact(spaceId, id), contactContent(next)))
      return next
    },
    deleteContact: (id: string) => r.del('contacts', id),
    async importContacts(cards: ContactCard[]): Promise<number> {
      let added = 0
      for (let i = 0; i < cards.length; i += 200) {
        const batch = await Promise.all(
          cards.slice(i, i + 200).map(async (c) => {
            const id = crypto.randomUUID()
            const content: ContactContent = { ...toCard(c), tags: [], favorite: false }
            return { id, space_id: spaceId, cipher: await r.seal(contexts.contact(spaceId, id), content) }
          }),
        )
        const inserted = await must<StoredContact[]>(supabase.from('contacts').insert(batch).select())
        inserted.forEach((row) => r.upsert('contacts', row))
        added += inserted.length
      }
      return added
    },

    // ── Notes ──
    async addNote(input: NoteContent): Promise<Note> {
      const id = crypto.randomUUID()
      const content: NoteContent = { title: input.title, body: input.body, pinned: input.pinned }
      const row = await r.insertSealed<StoredNote>('notes', { id, cipher: await r.seal(contexts.note(spaceId, id), content) })
      return { ...content, id, space_id: spaceId, created_by: userId, created_at: row.created_at, updated_at: row.updated_at }
    },
    async updateNote(id: string, patch: Partial<NoteContent>) {
      const n = { ...r.current(d.view.current.notes, id), ...patch }
      await r.updateSealed('notes', id, await r.seal(contexts.note(spaceId, id), { title: n.title, body: n.body, pinned: n.pinned }))
    },
    deleteNote: (id: string) => r.del('notes', id),

    // ── Lists ──
    async addList(input: ListContent): Promise<List> {
      const id = crypto.randomUUID()
      const content: ListContent = { title: input.title, emoji: input.emoji }
      const row = await r.insertSealed<StoredList>('lists', { id, cipher: await r.seal(contexts.list(spaceId, id), content) })
      return { ...content, id, space_id: spaceId, created_by: userId, created_at: row.created_at }
    },
    async updateList(id: string, patch: Partial<ListContent>): Promise<List> {
      const l = { ...r.current(d.view.current.lists, id), ...patch }
      await r.updateSealed('lists', id, await r.seal(contexts.list(spaceId, id), { title: l.title, emoji: l.emoji }))
      return l
    },
    deleteList: (id: string) => r.del('lists', id),

    async addItem(listId: string, text: string) {
      const id = crypto.randomUUID()
      const content: ItemContent = { text: text.trim(), done: false, due_date: null }
      await r.insertSealed('list_items', { id, list_id: listId, cipher: await r.seal(contexts.item(spaceId, listId, id), content) })
    },
    async updateItem(id: string, patch: Partial<ItemContent>) {
      const i = { ...r.current(d.view.current.list_items, id), ...patch }
      const content: ItemContent = { text: i.text, done: i.done, due_date: i.due_date }
      await r.updateSealed('list_items', id, await r.seal(contexts.item(spaceId, i.list_id, id), content))
    },
    deleteItem: (id: string) => r.del('list_items', id),
    async clearDone(listId: string) {
      // The server can't see which items are done, so the ids come from here.
      const done = d.view.current.list_items.filter((i) => i.list_id === listId && i.done).map((i) => i.id)
      if (!done.length) return
      await must(supabase.from('list_items').delete().in('id', done))
      done.forEach((id) => r.remove('list_items', id))
    },

    // ── Names ──
    async renameSpace(name: string) {
      const cipher = await r.seal(contexts.spaceName(spaceId), name)
      d.setSpace(await must<StoredSpace>(supabase.from('spaces').update({ name_cipher: cipher, name: null }).eq('id', spaceId).select().single()))
    },
    async renameMe(name: string) {
      const cipher = await r.seal(contexts.memberName(spaceId, userId), name)
      await must(supabase.from('members').update({ display_name_cipher: cipher, display_name: null }).eq('user_id', userId))
      d.setMembers((ms) => ms.map((m) => (m.user_id === userId ? { ...m, display_name_cipher: cipher, display_name: null } : m)))
    },
  }
}

export type ContentActions = ReturnType<typeof contentActions>
