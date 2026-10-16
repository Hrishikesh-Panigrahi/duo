// What every action needs from the store, and the shared ways of writing
// encrypted rows. Actions are created once, so they read the latest state
// through refs rather than closing over one render's values.
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
  /** Set by setUpEncryption on this device only, until upgradeLegacy finishes. */
  upgradePending: RefObject<boolean>
}

export function records(d: StoreDeps) {
  const upsert = (table: Table, row: AnyRow) => d.dispatch({ type: 'upsert', table, row })
  const remove = (table: Table, id: string) => d.dispatch({ type: 'remove', table, id })

  function requireKey(): CryptoKey {
    const key = d.key.current
    if (!key) throw new Error('Unlock Duo first.')
    return key
  }

  return {
    upsert,
    remove,
    requireKey,
    now: () => new Date().toISOString(),

    /** Encrypts `content` and remembers its plaintext, so it shows right away. */
    async seal(context: string, content: unknown): Promise<string> {
      const cipher = await encryptRecord(requireKey(), context, content)
      d.remember([[cacheKey(context, cipher), content]])
      return cipher
    },

    async insertSealed<T extends AnyRow>(table: Table, row: Record<string, unknown>): Promise<T> {
      const saved = await must<T>(supabase.from(table).insert({ ...row, space_id: d.spaceId }).select().single())
      upsert(table, saved)
      return saved
    },

    /** Replaces a row's ciphertext right away, then on the server; rolls back if that fails. */
    async updateSealed(table: Exclude<Table, 'messages'>, id: string, cipher: string) {
      const before = (d.rows.current[table] as AnyRow[]).find((r) => r.id === id)
      const values = { ...CLEARED[table], cipher }
      if (before) upsert(table, { ...before, ...values })
      try {
        upsert(table, await must<AnyRow>(supabase.from(table).update(values).eq('id', id).select().single()))
      } catch (e) {
        if (before) upsert(table, before)
        throw e
      }
    },

    async del(table: Table, id: string) {
      await must(supabase.from(table).delete().eq('id', id))
      remove(table, id)
    },

    /** The decrypted item to edit; throws if it's gone or not readable yet. */
    current<T extends { id: string }>(list: T[], id: string): T {
      const found = list.find((x) => x.id === id)
      if (!found) throw new Error('That was deleted, or is still unlocking.')
      return found
    },
  }
}

export type Records = ReturnType<typeof records>
