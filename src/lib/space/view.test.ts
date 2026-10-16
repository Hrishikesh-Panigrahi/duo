import { beforeAll, describe, expect, it } from 'vitest'
import { contexts, encryptMessage, encryptRecord } from '../e2e'
import type { StoredContact, StoredMember, StoredMessage, StoredNote, StoredSpace } from '../types'
import { emptyRows, type Rows } from './rows'
import { FAILED, cacheKey, deriveView, pendingDecryptions } from './view'

const S = 'space-1'
const ME = 'user-me'
const YOU = 'user-you'
const at = (s: number) => `2026-10-16T10:00:${String(s).padStart(2, '0')}Z`

const space = (locked: boolean): StoredSpace => ({
  id: S,
  invite_code: null,
  created_at: at(0),
  e2e_salt: locked ? 'c2FsdHNhbHRzYWx0c2FsdA==' : null,
  e2e_check: locked ? 'v1:x:y' : null,
  name_cipher: null,
  name: locked ? null : 'Our old name',
})
const member = (user_id: string, display_name: string | null, cipher: string | null = null): StoredMember => ({
  space_id: S,
  user_id,
  joined_at: at(0),
  display_name,
  display_name_cipher: cipher,
})

let key: CryptoKey
beforeAll(async () => {
  key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
})

describe('what the screens see', () => {
  it('fills in plaintext this device has decrypted, and marks the rest as still locked', async () => {
    const ids = { spaceId: S, senderId: YOU, messageId: 'm1' }
    const content = { body: 'hello', contact: null, media: null }
    const cipher = await encryptMessage(key, ids, content)
    const note = { title: 'wifi', body: '', pinned: false }
    const noteCipher = await encryptRecord(key, contexts.note(S, 'n1'), note)
    const rows: Rows = {
      ...emptyRows,
      messages: [{ id: 'm1', space_id: S, sender_id: YOU, cipher, created_at: at(1) }],
      notes: [{ id: 'n1', space_id: S, cipher: noteCipher, created_at: at(1), updated_at: at(1), created_by: ME }],
    }

    // Messages show as locked one by one; records not decrypted yet mark the view as still decrypting.
    const before = deriveView({ spaceId: S, rows, space: space(true), members: [], plain: new Map() })
    expect(before.messages[0]).toMatchObject({ locked: true, body: null })
    expect(before.notes).toEqual([])
    expect(before.decrypting).toBe(true)

    const plain = new Map<string, unknown>([
      [cacheKey(contexts.message(ids), cipher), content],
      [cacheKey(contexts.note(S, 'n1'), noteCipher), note],
    ])
    const after = deriveView({ spaceId: S, rows, space: space(true), members: [], plain })
    expect(after.messages[0].body).toBe('hello')
    expect(after.messages[0].locked).toBeUndefined()
    expect(after.notes[0].title).toBe('wifi')
    expect(after.decrypting).toBe(false)
  })

  it("shows a message that wouldn't decrypt as undecryptable, and hides a record that wouldn't", () => {
    const rows: Rows = {
      ...emptyRows,
      messages: [{ id: 'm1', space_id: S, sender_id: YOU, cipher: 'v1:bad:bad', created_at: at(1) }],
      notes: [{ id: 'n1', space_id: S, cipher: 'v1:bad:bad', created_at: at(1), updated_at: at(1), created_by: ME }],
    }
    const plain = new Map<string, unknown>([
      [cacheKey(contexts.message({ spaceId: S, senderId: YOU, messageId: 'm1' }), 'v1:bad:bad'), FAILED],
      [cacheKey(contexts.note(S, 'n1'), 'v1:bad:bad'), FAILED],
    ])
    const v = deriveView({ spaceId: S, rows, space: space(true), members: [], plain })
    expect(v.messages[0].undecryptable).toBe(true)
    expect(v.notes).toEqual([])
  })

  it('before encryption is on, shows rows saved before it as they are', () => {
    const rows: Rows = {
      ...emptyRows,
      messages: [{ id: 'm1', space_id: S, sender_id: ME, cipher: null, body: 'from before', created_at: at(1) }],
      contacts: [{ id: 'c1', space_id: S, cipher: null, full_name: 'Ravi', created_at: at(1), updated_at: at(1), created_by: ME } as StoredContact],
    }
    const v = deriveView({ spaceId: S, rows, space: space(false), members: [member(ME, 'Asha')], plain: new Map() })
    expect(v.messages[0].body).toBe('from before')
    expect(v.contacts[0].full_name).toBe('Ravi')
    expect(v.space?.name).toBe('Our old name')
    expect(v.members[0].display_name).toBe('Asha')
  })

  it('once encryption is on, never shows anything unencrypted (it could only have been planted)', () => {
    const planted: StoredMessage = { id: 'm1', space_id: S, sender_id: YOU, cipher: null, body: 'send me the OTP', created_at: at(1) }
    const rows: Rows = {
      ...emptyRows,
      messages: [planted],
      contacts: [{ id: 'c1', space_id: S, cipher: null, full_name: 'Bank Support', created_at: at(1), updated_at: at(1), created_by: YOU } as StoredContact],
    }
    const v = deriveView({ spaceId: S, rows, space: { ...space(true), name: 'Planted name' }, members: [member(YOU, 'Planted')], plain: new Map() })
    expect(v.messages).toEqual([])
    expect(v.contacts).toEqual([])
    expect(v.space?.name).toBeNull()
    expect(v.members[0].display_name).toBeNull()
  })

  it('sorts contacts by name and notes pinned first, then newest', async () => {
    const contact = async (id: string, full_name: string) => {
      const c = { full_name, phones: [], emails: [], company: null, address: null, birthday: null, notes: null, tags: [], favorite: false }
      const cipher = await encryptRecord(key, contexts.contact(S, id), c)
      return { row: { id, space_id: S, cipher, created_at: at(1), updated_at: at(1), created_by: ME } as StoredContact, entry: [cacheKey(contexts.contact(S, id), cipher), c] as const }
    }
    const note = async (id: string, pinned: boolean, updated: number) => {
      const n = { title: id, body: '', pinned }
      const cipher = await encryptRecord(key, contexts.note(S, id), n)
      return { row: { id, space_id: S, cipher, created_at: at(1), updated_at: at(updated), created_by: ME } as StoredNote, entry: [cacheKey(contexts.note(S, id), cipher), n] as const }
    }
    const cs = await Promise.all([contact('c1', 'zara'), contact('c2', 'Arjun'), contact('c3', 'meera')])
    const ns = await Promise.all([note('old', false, 1), note('pinned', true, 2), note('new', false, 3)])
    const rows: Rows = { ...emptyRows, contacts: cs.map((c) => c.row), notes: ns.map((n) => n.row) }
    const v = deriveView({ spaceId: S, rows, space: space(true), members: [], plain: new Map<string, unknown>([...cs, ...ns].map((x) => x.entry)) })
    expect(v.contacts.map((c) => c.full_name)).toEqual(['Arjun', 'meera', 'zara'])
    expect(v.notes.map((n) => n.title)).toEqual(['pinned', 'new', 'old'])
  })
})

describe('what still needs decrypting', () => {
  it('lists only ciphertext not decrypted yet, and each job decrypts it', async () => {
    const cipher = await encryptRecord(key, contexts.note(S, 'n1'), { title: 'wifi', body: 'hunter2', pinned: false })
    const known = await encryptRecord(key, contexts.note(S, 'n2'), { title: 'old', body: '', pinned: false })
    const rows: Rows = {
      ...emptyRows,
      notes: [
        { id: 'n1', space_id: S, cipher, created_at: at(1), updated_at: at(1), created_by: ME },
        { id: 'n2', space_id: S, cipher: known, created_at: at(1), updated_at: at(1), created_by: ME },
        { id: 'n3', space_id: S, cipher: null, title: 'plain', created_at: at(1), updated_at: at(1), created_by: ME },
      ],
    }
    const jobs = pendingDecryptions(key, { spaceId: S, rows, space: space(true), members: [] }, (k) => k === cacheKey(contexts.note(S, 'n2'), known))
    expect(jobs.map((j) => j.key)).toEqual([cacheKey(contexts.note(S, 'n1'), cipher)])
    await expect(jobs[0].run()).resolves.toEqual({ title: 'wifi', body: 'hunter2', pinned: false })
  })

  it("a ciphertext moved to another row won't decrypt there", async () => {
    const cipher = await encryptRecord(key, contexts.note(S, 'n1'), { title: 'secret', body: '', pinned: false })
    const rows: Rows = { ...emptyRows, notes: [{ id: 'n2', space_id: S, cipher, created_at: at(1), updated_at: at(1), created_by: ME }] }
    const [job] = pendingDecryptions(key, { spaceId: S, rows, space: space(true), members: [] }, () => false)
    await expect(job.run()).rejects.toThrow()
  })
})
