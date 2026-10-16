import { describe, expect, it } from 'vitest'
import { passphraseProblem, suggestPassphrase } from './passphrase'

describe('passphrase strength', () => {
  it.each([
    'short',
    'aaaaaaaaaaaaaaaa',
    'abababababababab',
    '1234567890123',
    'password12345',
    'iloveyoupriya2024',
    'qwertyuiop123',
    'Password!2025',
    'abcdefghijklmnop',
    'loveyou forever 1999',
  ])('refuses %j', (p) => {
    expect(passphraseProblem(p)).not.toBeNull()
  })

  it.each(['correct horse battery staple', 'mango kettle orbit velvet', 'k7mpx-2rtwq-9hnze-b4fya', 'we met at the blue door café'])(
    'accepts %j',
    (p) => {
      expect(passphraseProblem(p)).toBeNull()
    },
  )

  it('suggests strong, random, readable passphrases', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const p = suggestPassphrase()
      expect(p).toMatch(/^[a-km-z2-9]{5}(-[a-km-z2-9]{5}){3}$/)
      expect(p).not.toMatch(/[01lo]/)
      expect(passphraseProblem(p)).toBeNull()
      seen.add(p)
    }
    expect(seen.size).toBe(200)
  })
})
