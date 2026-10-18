import { beforeEach, describe, expect, it, vi } from 'vitest'

// What happened, in order, across the three modules sign-out touches.
const events = vi.hoisted(() => [] as string[])
const failClearingKeys = vi.hoisted(() => ({ now: false }))

vi.mock('./keystore', () => ({
  keystore: {
    clear: async () => {
      if (failClearingKeys.now) throw new Error('IndexedDB unavailable')
      events.push('keys cleared')
    },
  },
}))
vi.mock('./inbox', () => ({
  inbox: {
    clear: async () => {
      events.push('waiting photos cleared')
    },
  },
}))
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      signOut: async () => {
        events.push('signed out')
      },
    },
  },
}))

const { signOut } = await import('./session')

describe('signing out', () => {
  beforeEach(() => {
    events.length = 0
    failClearingKeys.now = false
  })

  it("wipes this device's keys and waiting photos before ending the session", async () => {
    await signOut()
    expect(events.slice(0, 2).sort()).toEqual(['keys cleared', 'waiting photos cleared'])
    expect(events.at(-1)).toBe('signed out')
  })

  it('still signs out if clearing the keys fails', async () => {
    failClearingKeys.now = true
    await signOut()
    expect(events).toEqual(['waiting photos cleared', 'signed out'])
  })
})
