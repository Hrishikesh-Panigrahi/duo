import { beforeAll, describe, expect, it } from 'vitest'
import { contexts, encryptRecord } from '../e2e'
import { emptyRows } from './rows'
import { shapes } from './shapes'
import { pendingDecryptions } from './view'

const contact = { full_name: 'Ravi', phones: ['+91 98765 43210'], emails: [], company: null, address: null, birthday: '1604-02-29', notes: null, tags: ['work'], favorite: false }
const message = { body: 'hi', contact: null, media: { kind: 'image', mime: 'image/jpeg', size: 1000, width: 10, height: 10 } }

describe('the shape every decrypted record must have', () => {
  it('accepts what the app itself writes', () => {
    expect(shapes.contact(contact)).toBe(true)
    expect(shapes.note({ title: '', body: 'x', pinned: true })).toBe(true)
    expect(shapes.list({ title: 'Groceries', emoji: null })).toBe(true)
    expect(shapes.item({ text: 'Milk', done: false, due_date: '2026-10-17' })).toBe(true)
    expect(shapes.message(message)).toBe(true)
    expect(shapes.message({ body: null, contact: { full_name: 'R', phones: [], emails: [] }, media: null })).toBe(true)
    expect(shapes.name('Priya')).toBe(true)
  })

  it('refuses anything that could break a screen', () => {
    const bad = [
      shapes.contact({ ...contact, full_name: 123 }),
      shapes.contact({ ...contact, phones: '+91' }),
      shapes.contact({ ...contact, tags: [1] }),
      shapes.contact({ ...contact, favorite: 'yes' }),
      shapes.contact({ ...contact, birthday: 'not a date' }),
      shapes.contact([contact]),
      shapes.note({ title: { evil: true }, body: '', pinned: false }),
      shapes.item({ text: 'x', done: 'no', due_date: null }),
      shapes.list({ title: ['x'], emoji: null }),
      shapes.message({ ...message, body: 42 }),
      shapes.message({ ...message, contact: { full_name: 'R', phones: 'x', emails: [] } }),
      shapes.message({ ...message, media: { ...message.media, kind: 'html' } }),
      shapes.message({ ...message, media: { ...message.media, size: -1 } }),
      shapes.name({ toString: 'x' }),
      shapes.name(null),
    ]
    expect(bad.every((ok) => ok === false)).toBe(true)
  })
})

describe('decrypting', () => {
  let key: CryptoKey
  beforeAll(async () => {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  })

  it('treats a record that decrypts but is the wrong shape as undecryptable', async () => {
    const S = 'space-1'
    const row = (id: string, cipher: string) => ({ id, space_id: S, cipher, created_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' })
    const good = await encryptRecord(key, contexts.contact(S, 'c1'), contact)
    const malformed = await encryptRecord(key, contexts.contact(S, 'c2'), { ...contact, full_name: 123 })
    const rows = { ...emptyRows, contacts: [row('c1', good), row('c2', malformed)] }
    const [first, second] = pendingDecryptions(key, { spaceId: S, rows, space: null, members: [] }, () => false)
    await expect(first.decrypt()).resolves.toEqual(contact)
    await expect(second.decrypt()).rejects.toThrow('Not the expected shape')
  })
})
