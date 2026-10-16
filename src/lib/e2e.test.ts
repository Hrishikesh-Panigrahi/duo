import { beforeAll, describe, expect, it } from 'vitest'
import { decryptMessage, deriveKey, encryptMessage, keyMatches, makeCheck, newSalt } from './e2e'

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
    expect(await decryptMessage(key, ids, cipher)).toEqual({ body: 'नमस्ते ❤️ see you at 7', contact: card })
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
    const check = await makeCheck(key, ids.spaceId)
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
