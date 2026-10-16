import { describe, expect, it } from 'vitest'
import { codeFromAddress, formatCode, inviteLink, normalizeCode } from './invite'

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
