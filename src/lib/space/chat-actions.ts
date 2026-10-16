// Chat: messages, contact cards, and view-once photos and videos. A photo or video goes straight to the
// other phone when both apps are open; otherwise it waits in Storage, encrypted, for up to MEDIA_TTL_DAYS.
import { contexts, decryptBytes, encryptBytes, encryptMessage, type MessageContent, type MessageIds } from '../e2e'
import { inbox } from '../inbox'
import { PLAYABLE_TYPE, isExpired, mediaPath, prepareMedia } from '../media'
import { must, serverError, supabase } from '../supabase'
import { toCard, type Message, type StoredMessage } from '../types'
import type { ContactCard } from '../vcard'
import { MESSAGE_LIMIT, type AnyRow } from './rows'
import { StoreActions } from './records'
import { cacheKey } from './view'

const MEDIA_BUCKET = 'media'
/** A directly delivered file whose message never arrived is dropped after this. */
const ORPHAN_GRACE_MS = 10 * 60_000

type BeforeInsert = (id: string, ids: MessageIds) => Promise<Record<string, unknown>>

export class ChatActions extends StoreActions {
  send(input: { body?: string; contact?: ContactCard }) {
    return this.sendContent({ body: input.body?.trim() || null, contact: input.contact ? toCard(input.contact) : null, media: null })
  }

  /** Sends a view-once photo or video, encrypted here: straight to their phone if it can take it, else via Storage. */
  async sendMedia(file: File) {
    const { bytes, info } = await prepareMedia(file)
    const key = this.records.requireKey()
    let uploaded = ''
    try {
      await this.sendContent({ body: null, contact: null, media: info }, { has_media: true }, async (id, ids) => {
        const encrypted = await encryptBytes(key, contexts.media(ids), bytes)
        if (await this.deliverDirectly(id, encrypted)) return { media_direct: true }
        uploaded = await this.upload(id, encrypted)
        return { media_direct: false }
      })
    } catch (e) {
      // Don't leave an encrypted file behind for a message that was never saved.
      if (uploaded) await supabase.storage.from(MEDIA_BUCKET).remove([uploaded]).catch(() => {})
      throw e
    }
  }

  /** Decrypts a photo or video; returns a URL that only works on this page. */
  async openMedia(m: Message): Promise<string> {
    const key = this.records.requireKey()
    const encrypted = (await inbox.get(m.id).catch(() => undefined)) ?? (await this.download(m))
    const ids = { spaceId: this.store.spaceId, senderId: m.sender_id, messageId: m.id }
    const bytes = await decryptBytes(key, contexts.media(ids), encrypted)
    // The type comes from the sender, so it's only used if it's a photo or video type.
    const type = m.media && PLAYABLE_TYPE.test(m.media.mime) ? m.media.mime : 'application/octet-stream'
    return URL.createObjectURL(new Blob([bytes], { type }))
  }

  /** Deletes a photo or video's file, wherever it was, and marks it opened. */
  async finishMedia(m: Message) {
    // Deleting comes first: even if marking it opened fails, there's no second look.
    await inbox.remove(m.id).catch(() => {})
    if (!m.media_direct) await supabase.storage.from(MEDIA_BUCKET).remove([mediaPath(this.store.spaceId, m.id)]).catch(() => {})
    await must(supabase.rpc('mark_media_opened', { message_id: m.id }))
    const row = this.store.rows.current.messages.find((x) => x.id === m.id)
    if (row) this.records.upsert('messages', { ...row, media_opened_at: new Date().toISOString() } as AnyRow)
  }

  /** Deletes files that were opened or expired, or whose message is gone, in Storage and on this device. */
  async sweepMedia(): Promise<number> {
    const messages = this.store.rows.current.messages
    const byId = new Map(messages.map((m) => [m.id, m]))
    return (await this.sweepStorage(byId)) + (await this.sweepInbox(messages, byId))
  }

  async remove(id: string) {
    const row = this.store.rows.current.messages.find((x) => x.id === id)
    await this.records.del('messages', id)
    await inbox.remove(id).catch(() => {})
    if (row?.has_media && !row.media_direct) await supabase.storage.from(MEDIA_BUCKET).remove([mediaPath(this.store.spaceId, id)])
  }

  /** Throttled "is typing" ping to the other person. */
  typing() {
    this.store.room.current?.typing()
  }

  /** Encrypts and sends a message. `beforeInsert` runs once its id is known, and can add fields to the row. */
  private async sendContent(content: MessageContent, extra: Record<string, unknown> = {}, beforeInsert?: BeforeInsert) {
    const { spaceId, userId } = this.store
    // The id is chosen here so it can be sealed into the ciphertext.
    const id = crypto.randomUUID()
    const ids: MessageIds = { spaceId, senderId: userId, messageId: id }
    const cipher = await encryptMessage(this.records.requireKey(), ids, content)
    this.store.remember([[cacheKey(contexts.message(ids), cipher), content]])
    const created_at = new Date().toISOString()
    const shown: StoredMessage = { id, space_id: spaceId, sender_id: userId, created_at, cipher, pending: true, ...extra }
    this.records.upsert('messages', shown)
    try {
      const more = (await beforeInsert?.(id, ids)) ?? {}
      const insert = supabase.from('messages').insert({ id, space_id: spaceId, cipher, ...extra, ...more })
      this.store.dispatch({ type: 'confirm', table: 'messages', tempId: id, row: await must<StoredMessage>(insert.select().single()) })
    } catch (e) {
      this.records.remove('messages', id)
      throw e
    }
  }

  /** False when their phone can't take a file right now, or the transfer failed. */
  private async deliverDirectly(id: string, encrypted: Uint8Array<ArrayBuffer>): Promise<boolean> {
    const partnerId = this.store.members.current.find((m) => m.user_id !== this.store.userId)?.user_id
    const room = this.store.room.current
    if (!room || !partnerId || !room.partnerCanTakeFile()) return false
    try {
      await room.sendFile(partnerId, id, encrypted)
      return true
    } catch (e) {
      if (import.meta.env.DEV) console.info('Direct delivery failed; using encrypted Storage instead.', e)
      return false
    }
  }

  /** Returns the path it was stored at. */
  private async upload(id: string, encrypted: Uint8Array<ArrayBuffer>): Promise<string> {
    const path = mediaPath(this.store.spaceId, id)
    const file = new Blob([encrypted], { type: 'application/octet-stream' })
    const options = { contentType: 'application/octet-stream', upsert: false }
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, options)
    if (error) throw serverError(error)
    return path
  }

  private async download(m: Message): Promise<ArrayBuffer> {
    if (m.media_direct) throw new Error('This was sent straight to another device of yours, so it can only be opened there.')
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(mediaPath(this.store.spaceId, m.id))
    if (error || !data) throw new Error('This was already opened, or it expired.')
    return data.arrayBuffer()
  }

  private async sweepStorage(byId: Map<string, StoredMessage>): Promise<number> {
    const bucket = supabase.storage.from(MEDIA_BUCKET)
    const { data } = await bucket.list(this.store.spaceId, { limit: 1000 })
    const stale = (data ?? [])
      .filter((file) => {
        const m = byId.get(file.name)
        if (!m) return file.created_at ? isExpired(file.created_at) : false
        return Boolean(m.media_opened_at) || isExpired(m.created_at)
      })
      .map((file) => mediaPath(this.store.spaceId, file.name))
    if (stale.length) await bucket.remove(stale)
    return stale.length
  }

  private async sweepInbox(messages: StoredMessage[], byId: Map<string, StoredMessage>): Promise<number> {
    // A message older than everything loaded could still exist, so only newer files can be orphans.
    const oldestLoaded = messages.length < MESSAGE_LIMIT ? -Infinity : Date.parse(messages[0].created_at)
    let removed = 0
    for (const file of await inbox.list().catch(() => [])) {
      const m = byId.get(file.messageId)
      const orphan = file.receivedAt > oldestLoaded && Date.now() - file.receivedAt > ORPHAN_GRACE_MS
      const expired = isExpired(new Date(file.receivedAt).toISOString())
      const gone = m ? Boolean(m.media_opened_at) || isExpired(m.created_at) : expired || orphan
      if (!gone) continue
      await inbox.remove(file.messageId).catch(() => {})
      removed++
    }
    return removed
  }
}
