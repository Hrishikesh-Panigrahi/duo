import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { contexts, deriveKey, encryptBytes, newSalt } from '../e2e'
import type { Message } from '../types'
import type { RowWriter, StoreDeps } from './store-actions'

// The encrypted file the stand-in Storage hands back when a photo is opened, and the phone's waiting files.
const stored = vi.hoisted(() => ({ file: new Blob() }))
const waiting = vi.hoisted(() => ({ files: [] as { messageId: string; receivedAt: number }[], removed: [] as string[] }))

vi.mock('../inbox', () => ({
  inbox: {
    get: async () => undefined,
    list: async () => waiting.files,
    remove: async (messageId: string) => {
      waiting.removed.push(messageId)
    },
  },
}))
vi.mock('../supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        download: async () => ({ data: stored.file, error: null }),
        list: async () => ({ data: [] }),
        remove: async () => ({}),
      }),
    },
  },
  must: async () => {},
  serverError: (e: Error) => e,
}))

const { ChatActions } = await import('./chat-actions')

const ids = { spaceId: 'space-1', senderId: 'user-you', messageId: 'msg-1' }

describe('opening a photo or video', () => {
  let key: CryptoKey
  let chat: InstanceType<typeof ChatActions>

  beforeAll(async () => {
    key = await deriveKey('correct horse battery staple', newSalt())
    const encrypted = await encryptBytes(key, contexts.media(ids), new TextEncoder().encode('<svg onload="alert(1)"/>').buffer)
    stored.file = new Blob([encrypted])
    chat = new ChatActions({ spaceId: ids.spaceId } as StoreDeps, { requireKey: () => key } as unknown as RowWriter)
  })
  afterEach(() => vi.restoreAllMocks())

  /** The type the decrypted file is handed to the page as, when the sender claims `mime`. */
  async function typeOpenedAs(mime: string) {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const message = { id: ids.messageId, sender_id: ids.senderId, media_direct: false, media: { kind: 'image', mime, size: 24 } }
    await chat.openMedia(message as unknown as Message)
    return (createObjectURL.mock.calls.at(-1)![0] as Blob).type
  }

  it('opens anything claimed as a non-photo, non-video type as a plain download, never as a page', async () => {
    expect(await typeOpenedAs('image/svg+xml')).toBe('application/octet-stream')
    expect(await typeOpenedAs('text/html')).toBe('application/octet-stream')
  })

  it('keeps the type of a real photo or video, so it displays', async () => {
    expect(await typeOpenedAs('image/jpeg')).toBe('image/jpeg')
    expect(await typeOpenedAs('video/mp4')).toBe('video/mp4')
  })
})

describe("clearing this phone's waiting photos", () => {
  const HOUR = 3_600_000

  it('leaves a photo that belongs to another space, until it expires', async () => {
    const now = Date.now()
    const opened = { id: 'opened-here', sender_id: 'user-you', created_at: new Date(now - HOUR).toISOString(), media_opened_at: new Date(now).toISOString() }
    const store = { spaceId: ids.spaceId, rows: { current: { messages: [opened] } } }
    const thisSpace = new ChatActions(store as unknown as StoreDeps, {} as RowWriter)
    waiting.files = [
      { messageId: 'opened-here', receivedAt: now - HOUR },
      { messageId: 'from-another-space', receivedAt: now - HOUR },
      { messageId: 'expired-anywhere', receivedAt: now - 25 * HOUR },
    ]
    waiting.removed = []
    await thisSpace.sweepMedia()
    expect(waiting.removed.sort()).toEqual(['expired-anywhere', 'opened-here'])
  })
})
