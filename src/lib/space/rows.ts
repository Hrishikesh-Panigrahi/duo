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

export const oldestFirst = <T extends AnyRow>(rows: T[]) => [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))

export const emptyRows: Rows = { contacts: [], messages: [], notes: [], lists: [], list_items: [] }

export type RowAction =
  | { type: 'load'; rows: Rows }
  | { type: 'upsert'; table: Table; row: AnyRow }
  | { type: 'remove'; table: Table; id: string }
  /** Swaps one row for another (an optimistic row for the confirmed one, or an old id for a new one). */
  | { type: 'confirm'; table: Table; replacedId: string; row: AnyRow }

export function rowsReducer(state: Rows, action: RowAction): Rows {
  switch (action.type) {
    case 'load': {
      // Keep messages still in flight; the load can't know about them yet.
      const stillSending = state.messages.filter((m) => m.pending && !action.rows.messages.some((r) => r.id === m.id))
      return { ...action.rows, messages: oldestFirst([...action.rows.messages, ...stillSending]) }
    }
    case 'upsert': {
      const rows = (state[action.table] as AnyRow[]).filter((r) => r.id !== action.row.id)
      return { ...state, [action.table]: oldestFirst([...rows, action.row]) }
    }
    case 'confirm': {
      const rows = (state[action.table] as AnyRow[]).filter((r) => r.id !== action.replacedId && r.id !== action.row.id)
      return { ...state, [action.table]: oldestFirst([...rows, action.row]) }
    }
    case 'remove': {
      const next = { ...state, [action.table]: (state[action.table] as AnyRow[]).filter((r) => r.id !== action.id) }
      if (action.table === 'lists') next.list_items = state.list_items.filter((i) => i.list_id !== action.id)
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
