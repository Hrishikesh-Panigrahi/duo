import { describe, expect, it, vi } from 'vitest'
import type { RowWriter, StoreDeps } from './store-actions'

// Which rows the rename asked the server to change.
const updates = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({
      update: () => {
        const filters: Record<string, unknown> = {}
        updates.push(filters)
        const query = {
          eq: (column: string, value: unknown) => {
            filters[column] = value
            return query
          },
          then: (resolve: (result: unknown) => void) => resolve({ data: null, error: null }),
        }
        return query
      },
    }),
  },
  must: async (query: PromiseLike<unknown>) => query,
  serverError: (e: Error) => e,
}))

const { NameActions } = await import('./content-actions')

describe('renaming yourself', () => {
  it("changes your name only in the space you're in: each space seals it with its own key", async () => {
    const store = { spaceId: 'space-1', userId: 'me', setMembers: () => {} }
    const writer = { seal: async () => 'v1:sealed:name' }
    await new NameActions(store as unknown as StoreDeps, writer as unknown as RowWriter).renameMe('Asha')
    expect(updates).toEqual([{ space_id: 'space-1', user_id: 'me' }])
  })
})
