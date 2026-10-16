import { describe, expect, it, vi } from 'vitest'
import { serverError } from './supabase'

describe('server errors shown to people', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('passes through messages our own database functions raise on purpose', () => {
    expect(serverError({ code: 'P0001', message: "That invite code doesn't match any space" }).message).toBe(
      "That invite code doesn't match any space",
    )
  })

  it.each([
    { code: '42501', message: 'permission denied for table messages' },
    { code: '42501', message: 'new row violates row-level security policy for table "messages"' },
    { code: '23514', message: 'new row for relation "contacts" violates check constraint "contacts_encrypted"' },
    { code: '23505', message: 'duplicate key value violates unique constraint "messages_pkey"' },
    { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    { code: '22P02', message: 'invalid input syntax for type uuid: "x"' },
    { message: 'new row violates row-level security policy' },
  ])('never shows database internals: $message', (e) => {
    const shown = serverError(e).message
    expect(shown).not.toMatch(/table|relation|constraint|row-level|policy|uuid|messages|contacts|pkey|JSON/i)
  })

  it('explains files that are too big', () => {
    expect(serverError({ message: 'The object exceeded the maximum allowed size' }).message).toBe('That file is too big to send.')
  })
})
