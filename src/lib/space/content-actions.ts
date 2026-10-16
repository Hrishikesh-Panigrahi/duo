// Contacts, notes, lists and names, each encrypted on this device before it's saved.
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
import { StoreActions } from './records'

const IMPORT_BATCH = 200

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

export class ContactActions extends StoreActions {
  async add(input: ContactInput): Promise<Contact> {
    const { spaceId, userId } = this.store
    const content = contactContent(input)
    const row = await this.records.insertSealed<StoredContact>('contacts', (id) => contexts.contact(spaceId, id), content)
    return { ...content, id: row.id, space_id: spaceId, created_by: userId, created_at: row.created_at, updated_at: row.updated_at }
  }

  async update(id: string, patch: Partial<ContactInput>): Promise<Contact> {
    const next = { ...this.records.current(this.store.view.current.contacts, id), ...patch }
    await this.records.updateSealed('contacts', id, contexts.contact(this.store.spaceId, id), contactContent(next))
    return next
  }

  remove(id: string) {
    return this.records.del('contacts', id)
  }

  /** Returns how many were saved. */
  async importCards(cards: ContactCard[]): Promise<number> {
    let added = 0
    for (let i = 0; i < cards.length; i += IMPORT_BATCH) {
      const batch = await Promise.all(cards.slice(i, i + IMPORT_BATCH).map((c) => this.sealCard(c)))
      const inserted = await must<StoredContact[]>(supabase.from('contacts').insert(batch).select())
      inserted.forEach((row) => this.records.upsert('contacts', row))
      added += inserted.length
    }
    return added
  }

  private async sealCard(card: ContactCard) {
    const id = crypto.randomUUID()
    const content: ContactContent = { ...toCard(card), tags: [], favorite: false }
    return { id, space_id: this.store.spaceId, cipher: await this.records.seal(contexts.contact(this.store.spaceId, id), content) }
  }
}

export class NoteActions extends StoreActions {
  async add(input: NoteContent): Promise<Note> {
    const { spaceId, userId } = this.store
    const content: NoteContent = { title: input.title, body: input.body, pinned: input.pinned }
    const row = await this.records.insertSealed<StoredNote>('notes', (id) => contexts.note(spaceId, id), content)
    return { ...content, id: row.id, space_id: spaceId, created_by: userId, created_at: row.created_at, updated_at: row.updated_at }
  }

  async update(id: string, patch: Partial<NoteContent>) {
    const n = { ...this.records.current(this.store.view.current.notes, id), ...patch }
    await this.records.updateSealed('notes', id, contexts.note(this.store.spaceId, id), { title: n.title, body: n.body, pinned: n.pinned })
  }

  remove(id: string) {
    return this.records.del('notes', id)
  }
}

export class ListActions extends StoreActions {
  async add(input: ListContent): Promise<List> {
    const { spaceId, userId } = this.store
    const content: ListContent = { title: input.title, emoji: input.emoji }
    const row = await this.records.insertSealed<StoredList>('lists', (id) => contexts.list(spaceId, id), content)
    return { ...content, id: row.id, space_id: spaceId, created_by: userId, created_at: row.created_at }
  }

  async update(id: string, patch: Partial<ListContent>): Promise<List> {
    const l = { ...this.records.current(this.store.view.current.lists, id), ...patch }
    await this.records.updateSealed('lists', id, contexts.list(this.store.spaceId, id), { title: l.title, emoji: l.emoji })
    return l
  }

  remove(id: string) {
    return this.records.del('lists', id)
  }

  async addItem(listId: string, text: string) {
    const content: ItemContent = { text: text.trim(), done: false, due_date: null }
    await this.records.insertSealed('list_items', (id) => contexts.item(this.store.spaceId, listId, id), content, { list_id: listId })
  }

  async updateItem(id: string, patch: Partial<ItemContent>) {
    const i = { ...this.records.current(this.store.view.current.list_items, id), ...patch }
    const content: ItemContent = { text: i.text, done: i.done, due_date: i.due_date }
    await this.records.updateSealed('list_items', id, contexts.item(this.store.spaceId, i.list_id, id), content)
  }

  removeItem(id: string) {
    return this.records.del('list_items', id)
  }

  async clearDone(listId: string) {
    // The server can't see which items are done, so the ids come from here.
    const done = this.store.view.current.list_items.filter((i) => i.list_id === listId && i.done).map((i) => i.id)
    if (!done.length) return
    await must(supabase.from('list_items').delete().in('id', done))
    done.forEach((id) => this.records.remove('list_items', id))
  }
}

export class NameActions extends StoreActions {
  async renameSpace(name: string) {
    const { spaceId } = this.store
    const cipher = await this.records.seal(contexts.spaceName(spaceId), name)
    const update = supabase.from('spaces').update({ name_cipher: cipher, name: null }).eq('id', spaceId)
    this.store.setSpace(await must<StoredSpace>(update.select().single()))
  }

  async renameMe(name: string) {
    const { spaceId, userId } = this.store
    const named = { display_name_cipher: await this.records.seal(contexts.memberName(spaceId, userId), name), display_name: null }
    await must(supabase.from('members').update(named).eq('user_id', userId))
    this.store.setMembers((ms) => ms.map((m) => (m.user_id === userId ? { ...m, ...named } : m)))
  }
}
