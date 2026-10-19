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
import { StoreActions } from './store-actions'

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
    const row = await this.writer.insertSealed<StoredContact>('contacts', (id) => contexts.contact(spaceId, id), content)
    return { ...content, id: row.id, space_id: spaceId, created_by: userId, created_at: row.created_at, updated_at: row.updated_at }
  }

  async update(id: string, patch: Partial<ContactInput>): Promise<Contact> {
    const next = { ...this.writer.requireDecrypted(this.store.view.current.contacts, id), ...patch }
    await this.writer.updateSealed('contacts', id, contexts.contact(this.store.spaceId, id), contactContent(next))
    return next
  }

  remove(id: string) {
    return this.writer.deleteRow('contacts', id)
  }

  /** Returns how many were saved. */
  async importCards(cards: ContactCard[]): Promise<number> {
    let added = 0
    for (let i = 0; i < cards.length; i += IMPORT_BATCH) {
      const batchCards = cards.slice(i, i + IMPORT_BATCH)
      const sealedRows = await Promise.all(batchCards.map((card) => this.sealCard(card)))
      const inserted = await must<StoredContact[]>(supabase.from('contacts').insert(sealedRows).select())
      for (const row of inserted) this.writer.upsertLocally('contacts', row)
      added += inserted.length
    }
    return added
  }

  private async sealCard(card: ContactCard) {
    const id = crypto.randomUUID()
    const content: ContactContent = { ...toCard(card), tags: [], favorite: false }
    return { id, space_id: this.store.spaceId, cipher: await this.writer.seal(contexts.contact(this.store.spaceId, id), content) }
  }
}

export class NoteActions extends StoreActions {
  async add(input: NoteContent): Promise<Note> {
    const { spaceId, userId } = this.store
    const content: NoteContent = { title: input.title, body: input.body, pinned: input.pinned }
    const row = await this.writer.insertSealed<StoredNote>('notes', (id) => contexts.note(spaceId, id), content)
    return { ...content, id: row.id, space_id: spaceId, created_by: userId, created_at: row.created_at, updated_at: row.updated_at }
  }

  async update(id: string, patch: Partial<NoteContent>) {
    const note = { ...this.writer.requireDecrypted(this.store.view.current.notes, id), ...patch }
    await this.writer.updateSealed('notes', id, contexts.note(this.store.spaceId, id), { title: note.title, body: note.body, pinned: note.pinned })
  }

  remove(id: string) {
    return this.writer.deleteRow('notes', id)
  }
}

export class ListActions extends StoreActions {
  async add(input: ListContent): Promise<List> {
    const { spaceId, userId } = this.store
    const content: ListContent = { title: input.title, emoji: input.emoji }
    const row = await this.writer.insertSealed<StoredList>('lists', (id) => contexts.list(spaceId, id), content)
    return { ...content, id: row.id, space_id: spaceId, created_by: userId, created_at: row.created_at }
  }

  async update(id: string, patch: Partial<ListContent>): Promise<List> {
    const list = { ...this.writer.requireDecrypted(this.store.view.current.lists, id), ...patch }
    await this.writer.updateSealed('lists', id, contexts.list(this.store.spaceId, id), { title: list.title, emoji: list.emoji })
    return list
  }

  remove(id: string) {
    return this.writer.deleteRow('lists', id)
  }

  async addItem(listId: string, text: string) {
    const content: ItemContent = { text: text.trim(), done: false, due_date: null }
    await this.writer.insertSealed('list_items', (id) => contexts.item(this.store.spaceId, listId, id), content, { list_id: listId })
  }

  async updateItem(id: string, patch: Partial<ItemContent>) {
    const item = { ...this.writer.requireDecrypted(this.store.view.current.list_items, id), ...patch }
    const content: ItemContent = { text: item.text, done: item.done, due_date: item.due_date }
    await this.writer.updateSealed('list_items', id, contexts.item(this.store.spaceId, item.list_id, id), content)
  }

  removeItem(id: string) {
    return this.writer.deleteRow('list_items', id)
  }

  async clearDone(listId: string) {
    // The server can't see which items are done, so the ids come from here.
    const doneIds = this.store.view.current.list_items.filter((i) => i.list_id === listId && i.done).map((i) => i.id)
    if (!doneIds.length) return
    await must(supabase.from('list_items').delete().in('id', doneIds))
    for (const id of doneIds) this.writer.removeLocally('list_items', id)
  }
}

export class NameActions extends StoreActions {
  async renameSpace(name: string) {
    const { spaceId } = this.store
    const cipher = await this.writer.seal(contexts.spaceName(spaceId), name)
    const update = supabase.from('spaces').update({ name_cipher: cipher, name: null }).eq('id', spaceId)
    this.store.setSpace(await must<StoredSpace>(update.select().single()))
  }

  async renameMe(name: string) {
    const { spaceId, userId } = this.store
    const encryptedName = { display_name_cipher: await this.writer.seal(contexts.memberName(spaceId, userId), name), display_name: null }
    // Only this space's row: each space seals your name with its own key.
    await must(supabase.from('members').update(encryptedName).eq('space_id', spaceId).eq('user_id', userId))
    this.store.setMembers((members) => members.map((m) => (m.user_id === userId ? { ...m, ...encryptedName } : m)))
  }
}
