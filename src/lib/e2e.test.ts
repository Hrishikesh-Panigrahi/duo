import { beforeAll, describe, expect, it } from 'vitest'
import {
  contexts,
  decryptBytes,
  decryptMessage,
  decryptRecord,
  deriveKey,
  encryptBytes,
  encryptMessage,
  encryptRecord,
  keyMatches,
  makeKeyCheck,
  newSalt,
} from './e2e'

const ids = { spaceId: 'space-1', senderId: 'user-a', messageId: 'msg-1' }
const card = { full_name: 'Mum', phones: ['+91 98765 43210'], emails: [] }

describe('end-to-end encryption', () => {
  const salt = newSalt()
  let key: CryptoKey

  beforeAll(async () => {
    key = await deriveKey('correct horse battery staple', salt)
  })

  it('round-trips text and contact cards, including non-ASCII', async () => {
    const cipher = await encryptMessage(key, ids, { body: 'नमस्ते ❤️ see you at 7', contact: card })
    expect(cipher).not.toContain('नमस्ते')
    expect(cipher).not.toContain('Mum')
    expect(await decryptMessage(key, ids, cipher)).toEqual({ body: 'नमस्ते ❤️ see you at 7', contact: card, media: null })
  })

  it('gives the same key on another device with the same passphrase', async () => {
    const otherDevice = await deriveKey('correct horse battery staple', salt)
    const cipher = await encryptMessage(key, ids, { body: 'hi', contact: null })
    expect((await decryptMessage(otherDevice, ids, cipher)).body).toBe('hi')
  })

  it('uses a fresh IV every time, so equal messages look different', async () => {
    const a = await encryptMessage(key, ids, { body: 'same', contact: null })
    const b = await encryptMessage(key, ids, { body: 'same', contact: null })
    expect(a).not.toBe(b)
  })

  it('rejects a wrong passphrase', async () => {
    const wrong = await deriveKey('correct horse battery stapler', salt)
    const cipher = await encryptMessage(key, ids, { body: 'secret', contact: null })
    await expect(decryptMessage(wrong, ids, cipher)).rejects.toThrow()
  })

  it('rejects ciphertext moved to another sender, space or message id', async () => {
    const cipher = await encryptMessage(key, ids, { body: 'from A', contact: null })
    await expect(decryptMessage(key, { ...ids, senderId: 'user-b' }, cipher)).rejects.toThrow()
    await expect(decryptMessage(key, { ...ids, spaceId: 'space-2' }, cipher)).rejects.toThrow()
    await expect(decryptMessage(key, { ...ids, messageId: 'msg-2' }, cipher)).rejects.toThrow()
  })

  it('rejects tampered ciphertext', async () => {
    const cipher = await encryptMessage(key, ids, { body: 'pay 100', contact: null })
    const [v, iv, ct] = cipher.split(':')
    const flipped = ct[5] === 'A' ? 'B' : 'A'
    await expect(decryptMessage(key, ids, `${v}:${iv}:${ct.slice(0, 5)}${flipped}${ct.slice(6)}`)).rejects.toThrow()
  })

  it('tells the right passphrase from a wrong one using the check value', async () => {
    const check = await makeKeyCheck(key, ids.spaceId)
    expect(await keyMatches(await deriveKey('correct horse battery staple', salt), ids.spaceId, check)).toBe(true)
    expect(await keyMatches(await deriveKey('wrong passphrase!!', salt), ids.spaceId, check)).toBe(false)
    expect(await keyMatches(key, 'another-space', check)).toBe(false)
  })

  it('makes a different key from the same passphrase with a different salt', async () => {
    const other = await deriveKey('correct horse battery staple', newSalt())
    const cipher = await encryptMessage(key, ids, { body: 'x', contact: null })
    await expect(decryptMessage(other, ids, cipher)).rejects.toThrow()
  })
})

describe('encrypting everything else', () => {
  const salt = newSalt()
  let key: CryptoKey

  beforeAll(async () => {
    key = await deriveKey('correct horse battery staple', salt)
  })

  it('round-trips a contact, a note, a list item and names', async () => {
    const contact = { full_name: 'Mum', phones: ['+91 98765 43210'], emails: [], company: null, address: null, birthday: '1965-10-20', notes: 'Loves jasmine', tags: ['family'], favorite: true }
    const c = await encryptRecord(key, contexts.contact('s', 'c1'), contact)
    expect(c).not.toMatch(/Mum|jasmine|family/)
    expect(await decryptRecord(key, contexts.contact('s', 'c1'), c)).toEqual(contact)

    const item = { text: 'Milk', done: true, due_date: '2026-10-20' }
    const i = await encryptRecord(key, contexts.item('s', 'list-1', 'i1'), item)
    expect(await decryptRecord(key, contexts.item('s', 'list-1', 'i1'), i)).toEqual(item)

    const name = await encryptRecord(key, contexts.memberName('s', 'user-a'), 'Asha')
    expect(await decryptRecord(key, contexts.memberName('s', 'user-a'), name)).toBe('Asha')
  })

  it("won't decrypt a record copied into another row, list, field or space", async () => {
    const c = await encryptRecord(key, contexts.contact('s', 'c1'), { full_name: 'X' })
    await expect(decryptRecord(key, contexts.contact('s', 'c2'), c)).rejects.toThrow()
    await expect(decryptRecord(key, contexts.note('s', 'c1'), c)).rejects.toThrow()
    await expect(decryptRecord(key, contexts.contact('other-space', 'c1'), c)).rejects.toThrow()

    const item = await encryptRecord(key, contexts.item('s', 'list-1', 'i1'), { text: 'x' })
    await expect(decryptRecord(key, contexts.item('s', 'list-2', 'i1'), item)).rejects.toThrow()

    const asha = await encryptRecord(key, contexts.memberName('s', 'user-a'), 'Asha')
    await expect(decryptRecord(key, contexts.memberName('s', 'user-b'), asha)).rejects.toThrow()
    await expect(decryptRecord(key, contexts.spaceName('s'), asha)).rejects.toThrow()
  })

  it('encrypts files byte for byte, and rejects them if tampered with or moved', async () => {
    const ids = { spaceId: 's', senderId: 'a', messageId: 'm1' }
    const photo = new Uint8Array(200_000).map((_, i) => (i * 31) % 256)
    const sealed = await encryptBytes(key, contexts.media(ids), photo.buffer)
    expect(sealed.length).toBe(photo.length + 1 + 12 + 16)
    const back = new Uint8Array(await decryptBytes(key, contexts.media(ids), sealed.buffer))
    expect(back).toEqual(photo)

    const tampered = sealed.slice()
    tampered[5000] ^= 1
    await expect(decryptBytes(key, contexts.media(ids), tampered.buffer)).rejects.toThrow()
    await expect(decryptBytes(key, contexts.media({ ...ids, messageId: 'm2' }), sealed.buffer)).rejects.toThrow()
    const wrongKey = await deriveKey('another passphrase entirely', salt)
    await expect(decryptBytes(wrongKey, contexts.media(ids), sealed.buffer)).rejects.toThrow()
  })

  it('keeps media details inside the encrypted message', async () => {
    const ids = { spaceId: 's', senderId: 'a', messageId: 'm1' }
    const media = { kind: 'image' as const, mime: 'image/jpeg', size: 12345, width: 1600, height: 1200 }
    const cipher = await encryptMessage(key, ids, { body: null, contact: null, media })
    expect(cipher).not.toContain('image/jpeg')
    expect((await decryptMessage(key, ids, cipher)).media).toEqual(media)
  })
})

describe('what must never change', () => {
  it('keeps the key inside the browser: it cannot be exported', async () => {
    const key = await deriveKey('correct horse battery staple', newSalt())
    expect(key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
  })

  it('seals each kind of data under the same label as always, so stored data keeps decrypting', () => {
    expect(contexts.message({ spaceId: 's', senderId: 'u', messageId: 'm' })).toBe('duo:msg:s:u:m')
    expect(contexts.media({ spaceId: 's', senderId: 'u', messageId: 'm' })).toBe('duo:media:s:u:m')
    expect(contexts.contact('s', 'c')).toBe('duo:contact:s:c')
    expect(contexts.note('s', 'n')).toBe('duo:note:s:n')
    expect(contexts.list('s', 'l')).toBe('duo:list:s:l')
    expect(contexts.item('s', 'l', 'i')).toBe('duo:item:s:l:i')
    expect(contexts.spaceName('s')).toBe('duo:space-name:s')
    expect(contexts.memberName('s', 'u')).toBe('duo:member-name:s:u')
    expect(contexts.signal('s')).toBe('duo:signal:s')
    expect(contexts.check('s')).toBe('duo:check:s')
  })
})
