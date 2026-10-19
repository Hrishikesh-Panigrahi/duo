import { beforeAll, describe, expect, it, vi } from 'vitest'
import { contexts, deriveKey, encryptRecord, newSalt } from './e2e'

// Two spaces: "one" is unlocked on this device, "two" isn't. Each test sets what the server holds.
const server = vi.hoisted(() => ({ spaces: [] as object[], members: [] as object[] }))
const keys = vi.hoisted(() => new Map<string, CryptoKey>())

function fakeQuery(table: string) {
  const filters: Record<string, unknown> = {}
  const query = {
    select: () => query,
    in: () => query,
    eq: (column: string, value: unknown) => {
      filters[column] = value
      return query
    },
    neq: (column: string, value: unknown) => {
      filters[`not ${column}`] = value
      return query
    },
    gt: (_column: string, value: string) => {
      filters.since = value
      return query
    },
    then: (resolve: (result: unknown) => void) => {
      // Three of their messages since the last read; counting your own as well would give 5.
      const onlyTheirs = filters['not sender_id'] === 'me'
      if (table === 'messages') resolve({ count: filters.since ? (onlyTheirs ? 3 : 5) : 99, error: null })
      else resolve({ data: table === 'spaces' ? server.spaces : server.members, error: null })
    },
  }
  return query
}

vi.mock('./supabase', () => ({
  supabase: { from: (table: string) => fakeQuery(table) },
  must: async (query: PromiseLike<{ data: unknown }>) => (await query).data,
}))
vi.mock('./keystore', () => ({ keystore: { get: async (spaceId: string) => keys.get(spaceId) } }))
vi.mock('./device-storage', () => ({ deviceStorage: { get: (key: string) => (key === 'duo:lastRead:one' ? '2026-10-19T10:00:00Z' : null) } }))

const { loadSpaceSummaries, spaceToOpen } = await import('./spaces')

describe('which space opens', () => {
  it('reopens the space you used last on this device', () => {
    expect(spaceToOpen(['old', 'last'], 'last')).toBe('last')
  })

  it('opens your oldest space if the last one is no longer yours, or none was remembered', () => {
    expect(spaceToOpen(['old', 'new'], 'gone')).toBe('old')
    expect(spaceToOpen(['old', 'new'], null)).toBe('old')
  })

  it('has nothing to open before you start or join a space', () => {
    expect(spaceToOpen([], 'gone')).toBeNull()
  })
})

describe('what the switcher shows for each space', () => {
  beforeAll(async () => {
    const key = await deriveKey('correct horse battery staple', newSalt())
    keys.set('one', key)
    server.spaces = [
      { id: 'one', e2e_salt: 'salt', name: null, name_cipher: await encryptRecord(key, contexts.spaceName('one'), 'Us') },
      { id: 'two', e2e_salt: 'salt', name: 'planted plaintext', name_cipher: null },
    ]
    server.members = [
      { space_id: 'one', user_id: 'me' },
      { space_id: 'one', user_id: 'you', display_name: null, display_name_cipher: await encryptRecord(key, contexts.memberName('one', 'you'), 'Asha') },
      { space_id: 'two', user_id: 'me' },
    ]
  })

  it("decrypts a space's name and your person's with that space's own key", async () => {
    const [one] = await loadSpaceSummaries(['one', 'two'], 'me')
    expect(one).toMatchObject({ name: 'Us', partnerName: 'Asha', hasPartner: true, locked: false, unread: 3 })
  })

  it("shows a space as locked, never its plaintext, when this device doesn't have its key", async () => {
    // Never opened on this device, so there's no last-read time: no unread count is asked for.
    const [, two] = await loadSpaceSummaries(['one', 'two'], 'me')
    expect(two).toMatchObject({ name: null, partnerName: null, hasPartner: false, locked: true, unread: 0 })
  })
})
