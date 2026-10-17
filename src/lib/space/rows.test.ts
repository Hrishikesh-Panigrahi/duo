import { describe, expect, it } from 'vitest'
import { emptyRows, rowsReducer, type Rows } from './rows'
import type { StoredItem, StoredList, StoredMessage } from '../types'

const msg = (id: string, at: string, extra: Partial<StoredMessage> = {}): StoredMessage => ({
  id,
  space_id: 's',
  sender_id: 'u',
  cipher: 'v1:x:y',
  created_at: at,
  ...extra,
})

describe('rows as stored', () => {
  it('keeps a message still being sent when a fresh load arrives without it', () => {
    let rows = rowsReducer(emptyRows, { type: 'upsert', table: 'messages', row: msg('temp', '2026-10-16T10:00:05Z', { pending: true }) })
    rows = rowsReducer(rows, { type: 'load', rows: { ...emptyRows, messages: [msg('a', '2026-10-16T10:00:00Z')] } })
    expect(rows.messages.map((m) => m.id)).toEqual(['a', 'temp'])
  })

  it('drops the pending copy once the load includes the real one', () => {
    let rows = rowsReducer(emptyRows, { type: 'upsert', table: 'messages', row: msg('m1', '2026-10-16T10:00:05Z', { pending: true }) })
    rows = rowsReducer(rows, { type: 'load', rows: { ...emptyRows, messages: [msg('m1', '2026-10-16T10:00:05Z')] } })
    expect(rows.messages).toHaveLength(1)
    expect(rows.messages[0].pending).toBeUndefined()
  })

  it('replaces a row by id and keeps everything in time order', () => {
    let rows: Rows = rowsReducer(emptyRows, { type: 'upsert', table: 'messages', row: msg('b', '2026-10-16T10:00:02Z') })
    rows = rowsReducer(rows, { type: 'upsert', table: 'messages', row: msg('a', '2026-10-16T10:00:01Z') })
    rows = rowsReducer(rows, { type: 'upsert', table: 'messages', row: msg('b', '2026-10-16T10:00:02Z', { cipher: 'v1:new:new' }) })
    expect(rows.messages.map((m) => [m.id, m.cipher])).toEqual([
      ['a', 'v1:x:y'],
      ['b', 'v1:new:new'],
    ])
  })

  it('swaps an optimistic row for the confirmed one', () => {
    let rows = rowsReducer(emptyRows, { type: 'upsert', table: 'messages', row: msg('old', '2026-10-16T10:00:00Z', { pending: true }) })
    rows = rowsReducer(rows, { type: 'confirm', table: 'messages', replacedId: 'old', row: msg('new', '2026-10-16T10:00:00Z') })
    expect(rows.messages.map((m) => m.id)).toEqual(['new'])
  })

  it("removing a list removes its items too, and nothing else's", () => {
    const list = (id: string): StoredList => ({ id, space_id: 's', cipher: 'v1:a:b', created_at: '2026-10-16T10:00:00Z', created_by: 'u' })
    const item = (id: string, list_id: string): StoredItem => ({ ...list(id), list_id })
    const rows: Rows = { ...emptyRows, lists: [list('L1'), list('L2')], list_items: [item('i1', 'L1'), item('i2', 'L2')] }
    const after = rowsReducer(rows, { type: 'remove', table: 'lists', id: 'L1' })
    expect(after.lists.map((l) => l.id)).toEqual(['L2'])
    expect(after.list_items.map((i) => i.id)).toEqual(['i2'])
  })
})
