import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { contexts, deriveKey, encryptBytes, newSalt } from '../e2e'
import type { Message } from '../types'
import type { RowWriter, StoreDeps } from './store-actions'

// The encrypted file the stand-in Storage hands back when a photo is opened.
const stored = vi.hoisted(() => ({ file: new Blob() }))

vi.mock('../inbox', () => ({ inbox: { get: async () => undefined } }))
vi.mock('../supabase', () => ({
  supabase: { storage: { from: () => ({ download: async () => ({ data: stored.file, error: null }) }) } },
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
