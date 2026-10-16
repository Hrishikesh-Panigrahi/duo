// A space's rows exactly as stored: ciphertext plus the ids and timestamps the server needs.
import type {
  ContactContent,
  ItemContent,
  ListContent,
  NoteContent,
  StoredContact,
  StoredItem,
  StoredList,
  StoredMessage,
  StoredNote,
} from '../types'

export type Rows = {
  contacts: StoredContact[]
  messages: StoredMessage[]
  notes: StoredNote[]
  lists: StoredList[]
  list_items: StoredItem[]
}
export type Table = keyof Rows
export type AnyRow = { id: string; created_at: string }

export const TABLES: Table[] = ['contacts', 'messages', 'notes', 'lists', 'list_items']
/** Only the newest messages are loaded. */
export const MESSAGE_LIMIT = 500

/** Oldest first. */
export const sorted = <T extends AnyRow>(rows: T[]) => [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))

export const emptyRows: Rows = { contacts: [], messages: [], notes: [], lists: [], list_items: [] }

export type RowAction =
  | { type: 'load'; rows: Rows }
  | { type: 'upsert'; table: Table; row: AnyRow }
  | { type: 'remove'; table: Table; id: string }
  /** Swaps one row for another (an optimistic row for the confirmed one, or an old id for a new one). */
  | { type: 'confirm'; table: Table; tempId: string; row: AnyRow }

export function rowsReducer(state: Rows, a: RowAction): Rows {
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

// Every write clears the old plaintext columns, so rows from before encryption pass the database's rules.
export const CLEARED = {
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

/** Reading rows from before encryption. */
export const legacy = {
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
