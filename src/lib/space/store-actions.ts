// What every action needs from the store, and the shared ways of writing encrypted rows.
// Actions are created once, so they read the latest state through refs.
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { encryptRecord } from '../e2e'
import { must, supabase } from '../supabase'
import type { StoredMember, StoredSpace } from '../types'
import { CLEARED, type AnyRow, type RowAction, type Rows, type Table } from './rows'
import type { Room } from './room'
import type { Remember } from './plaintext'
import { cacheKey, type SpaceView } from './view'

export type StoreDeps = {
  spaceId: string
  userId: string
  dispatch: Dispatch<RowAction>
  remember: Remember
  forgetPlaintext: () => void
  key: RefObject<CryptoKey | null>
  setKey: (key: CryptoKey | null) => void
  rows: RefObject<Rows>
  space: RefObject<StoredSpace | null>
  members: RefObject<StoredMember[]>
  view: RefObject<SpaceView>
  setSpace: Dispatch<SetStateAction<StoredSpace | null>>
  setMembers: Dispatch<SetStateAction<StoredMember[]>>
  room: RefObject<Room | null>
}

export class RowWriter {
  constructor(private readonly store: StoreDeps) {}

  upsertLocally(table: Table, row: AnyRow) {
    this.store.dispatch({ type: 'upsert', table, row })
  }

  removeLocally(table: Table, id: string) {
    this.store.dispatch({ type: 'remove', table, id })
  }

  requireKey(): CryptoKey {
    const key = this.store.key.current
    if (!key) throw new Error('Unlock Duo first.')
    return key
  }

  /** Encrypts `content` and remembers its plaintext, so it shows right away. */
  async seal(context: string, content: unknown): Promise<string> {
    const cipher = await encryptRecord(this.requireKey(), context, content)
    this.store.remember([[cacheKey(context, cipher), content]])
    return cipher
  }

  /** Saves a new row holding `content`, sealed to the context its new id gives. */
  async insertSealed<T extends AnyRow>(table: Table, context: (id: string) => string, content: unknown, extraColumns = {}): Promise<T> {
    const id = crypto.randomUUID()
    const row = { ...extraColumns, id, space_id: this.store.spaceId, cipher: await this.seal(context(id), content) }
    const saved = await must<T>(supabase.from(table).insert(row).select().single())
    this.upsertLocally(table, saved)
    return saved
  }

  /** Replaces a row's content right away, then on the server; rolls back if that fails. */
  async updateSealed(table: Exclude<Table, 'messages'>, id: string, context: string, content: unknown) {
    const values = { ...CLEARED[table], cipher: await this.seal(context, content) }
    const before = (this.store.rows.current[table] as AnyRow[]).find((r) => r.id === id)
    if (before) this.upsertLocally(table, { ...before, ...values })
    try {
      this.upsertLocally(table, await must<AnyRow>(supabase.from(table).update(values).eq('id', id).select().single()))
    } catch (e) {
      if (before) this.upsertLocally(table, before)
      throw e
    }
  }

  async deleteRow(table: Table, id: string) {
    await must(supabase.from(table).delete().eq('id', id))
    this.removeLocally(table, id)
  }

  /** The decrypted item to edit; throws if it's gone or not readable yet. */
  requireDecrypted<T extends { id: string }>(list: T[], id: string): T {
    const found = list.find((x) => x.id === id)
    if (!found) throw new Error('That was deleted, or is still unlocking.')
    return found
  }
}

/** What each group of actions is built on. */
export abstract class StoreActions {
  constructor(
    protected readonly store: StoreDeps,
    protected readonly writer: RowWriter,
  ) {}
}
