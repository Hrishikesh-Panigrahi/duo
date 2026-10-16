import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codeFromAddress, formatCode, inviteLink, normalizeCode, pendingInvite } from './invite'

describe('invite links', () => {
  it('builds a link with the code after the #, so it never reaches a server', () => {
    expect(inviteLink('4BSSWUMN', 'https://our-duo.pages.dev')).toBe('https://our-duo.pages.dev/join#4BSS-WUMN')
    expect(formatCode('4BSSWUMN')).toBe('4BSS-WUMN')
  })

  it('reads the code back from the link, however it was typed', () => {
    expect(codeFromAddress('/join', '#4BSS-WUMN')).toBe('4BSSWUMN')
    expect(codeFromAddress('/join/', '#4bss-wumn')).toBe('4BSSWUMN')
    expect(codeFromAddress('/join', '#4BSS%20WUMN')).toBe('4BSSWUMN')
  })

  it('ignores anything that is not an invite link or a valid code', () => {
    expect(codeFromAddress('/', '#4BSS-WUMN')).toBeNull()
    expect(codeFromAddress('/join', '')).toBeNull()
    expect(codeFromAddress('/join', '#access_token=eyJabc&type=signup')).toBeNull()
    expect(codeFromAddress('/join', '#<script>alert(1)</script>')).toBeNull()
    expect(codeFromAddress('/join', '#%E0%A4%A')).toBeNull() // malformed escape
    expect(normalizeCode('4BSS-WUM')).toBeNull() // too short
    expect(normalizeCode('4BSS-WUMNX')).toBeNull() // too long
    expect(normalizeCode('0BSS-WUMN')).toBeNull() // 0, 1, I, L, O are never used
    expect(normalizeCode('IBSS-WUMN')).toBeNull()
  })
})

describe('the invite kept on this device', () => {
  const saved = new Map<string, string>()
  beforeEach(() => {
    saved.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
      removeItem: (k: string) => void saved.delete(k),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps a code until it is used, for two weeks at most', () => {
    pendingInvite.set('4BSSWUMN')
    expect(pendingInvite.get()).toBe('4BSSWUMN')
    expect(pendingInvite.get(Date.now() + 15 * 86_400_000)).toBeNull()
    expect(saved.has('duo:invite')).toBe(false)
    pendingInvite.set('4BSSWUMN')
    pendingInvite.clear()
    expect(pendingInvite.get()).toBeNull()
  })

  it('ignores junk, and carries on when storage is blocked', () => {
    saved.set('duo:invite', '{not json')
    expect(pendingInvite.get()).toBeNull()
    saved.set('duo:invite', JSON.stringify({ code: '<script>', at: Date.now() }))
    expect(pendingInvite.get()).toBeNull()
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(() => pendingInvite.set('4BSSWUMN')).not.toThrow()
    expect(pendingInvite.get()).toBeNull()
    expect(() => pendingInvite.clear()).not.toThrow()
  })
})
