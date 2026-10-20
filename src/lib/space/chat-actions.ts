// Chat: messages, contact cards, and view-once photos and videos. A photo or video goes straight to the
// other phone when both apps are open; otherwise it waits in Storage, encrypted, for up to MEDIA_TTL_HOURS.
import { contexts, decryptBytes, encryptBytes, encryptMessage, type MessageContent, type MessageIds } from '../e2e'
import { inbox } from '../inbox'
import { PLAYABLE_TYPE, isExpired, mediaPath, prepareMedia } from '../media'
import { must, serverError, supabase } from '../supabase'
import { toCard, type Message, type StoredMessage } from '../types'
import type { ContactCard } from '../vcard'
import type { AnyRow } from './rows'
import { StoreActions } from './store-actions'
import { cacheKey } from './view'

const MEDIA_BUCKET = 'media'

type BeforeInsert = (id: string, ids: MessageIds) => Promise<Record<string, unknown>>

export class ChatActions extends StoreActions {
  send(input: { body?: string; contact?: ContactCard }) {
    return this.sendContent({ body: input.body?.trim() || null, contact: input.contact ? toCard(input.contact) : null, media: null })
  }

  /** Sends a view-once photo or video, encrypted here: straight to their phone if it can take it, else via Storage. */
  async sendMedia(file: File) {
    const { bytes, info } = await prepareMedia(file)
    const key = this.writer.requireKey()
    let uploadedPath = ''
    try {
      await this.sendContent({ body: null, contact: null, media: info }, { has_media: true }, async (id, ids) => {
        const encrypted = await encryptBytes(key, contexts.media(ids), bytes)
        if (await this.deliverDirectly(id, encrypted)) return { media_direct: true }
        uploadedPath = await this.upload(id, encrypted)
        return { media_direct: false }
      })
    } catch (e) {
      // Don't leave an encrypted file behind for a message that was never saved.
      if (uploadedPath) await supabase.storage.from(MEDIA_BUCKET).remove([uploadedPath]).catch(() => {})
      throw e
    }
  }

  /** Decrypts a photo or video; returns a URL that only works on this page. */
  async openMedia(message: Message): Promise<string> {
    const key = this.writer.requireKey()
    const receivedDirectly = await inbox.get(message.id).catch(() => undefined)
    const encrypted = receivedDirectly ?? (await this.download(message))
    const ids = { spaceId: this.store.spaceId, senderId: message.sender_id, messageId: message.id }
    const bytes = await decryptBytes(key, contexts.media(ids), encrypted)
    // The type comes from the sender, so it's only used if it's a photo or video type.
    const type = message.media && PLAYABLE_TYPE.test(message.media.mime) ? message.media.mime : 'application/octet-stream'
    return URL.createObjectURL(new Blob([bytes], { type }))
  }

  /** Deletes a photo or video's file, wherever it was, and marks it opened. */
  async deleteViewedMedia(message: Message) {
    // Deleting comes first: even if marking it opened fails, there's no second look.
    await inbox.remove(message.id).catch(() => {})
    if (!message.media_direct) await supabase.storage.from(MEDIA_BUCKET).remove([mediaPath(this.store.spaceId, message.id)]).catch(() => {})
    await must(supabase.rpc('mark_media_opened', { message_id: message.id }))
    const row = this.store.rows.current.messages.find((x) => x.id === message.id)
    if (row) this.writer.upsertLocally('messages', { ...row, media_opened_at: new Date().toISOString() } as AnyRow)
  }

  /** Deletes files that were opened or expired, or whose message is gone, in Storage and on this device. */
  async sweepMedia(): Promise<number> {
    const messages = this.store.rows.current.messages
    const messagesById = new Map(messages.map((m) => [m.id, m]))
    return (await this.sweepStorage(messagesById)) + (await this.sweepInbox(messagesById))
  }

  /** Either of you can turn vanish mode on or off; it applies to messages sent from then on. */
  async setVanishMode(turnOn: boolean) {
    await must(supabase.rpc('set_vanish_mode', { space: this.store.spaceId, turn_on: turnOn }))
    this.store.setSpace((space) => space && { ...space, vanish_mode: turnOn })
  }

  /** Their vanishing messages have been on your screen. */
  async markVanishingSeen(messageIds: string[]) {
    await must(supabase.rpc('mark_vanishing_seen', { message_ids: messageIds }))
  }

  /** Deletes this space's vanishing messages that have been seen, for both of you. */
  async clearSeenVanishing() {
    await must(supabase.rpc('clear_seen_vanishing', { space: this.store.spaceId }))
  }

  async remove(id: string) {
    const row = this.store.rows.current.messages.find((x) => x.id === id)
    await this.writer.deleteRow('messages', id)
    await inbox.remove(id).catch(() => {})
    if (row?.has_media && !row.media_direct) await supabase.storage.from(MEDIA_BUCKET).remove([mediaPath(this.store.spaceId, id)])
  }

  /** Throttled "is typing" ping to the other person. */
  sendTyping() {
    this.store.room.current?.sendTyping()
  }

  /** Encrypts and sends a message. `beforeInsert` runs once its id is known, and can add fields to the row. */
  private async sendContent(content: MessageContent, extraColumns: Record<string, unknown> = {}, beforeInsert?: BeforeInsert) {
    const { spaceId, userId } = this.store
    // The id is chosen here so it can be sealed into the ciphertext.
    const id = crypto.randomUUID()
    const ids: MessageIds = { spaceId, senderId: userId, messageId: id }
    const cipher = await encryptMessage(this.writer.requireKey(), ids, content)
    this.store.remember([[cacheKey(contexts.message(ids), cipher), content]])
    const created_at = new Date().toISOString()
    const pendingRow: StoredMessage = { id, space_id: spaceId, sender_id: userId, created_at, cipher, pending: true, ...extraColumns }
    this.writer.upsertLocally('messages', pendingRow)
    try {
      const addedColumns = (await beforeInsert?.(id, ids)) ?? {}
      const insertQuery = supabase.from('messages').insert({ id, space_id: spaceId, cipher, ...extraColumns, ...addedColumns })
      this.store.dispatch({ type: 'confirm', table: 'messages', replacedId: id, row: await must<StoredMessage>(insertQuery.select().single()) })
    } catch (e) {
      this.writer.removeLocally('messages', id)
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

  private async download(message: Message): Promise<ArrayBuffer> {
    if (message.media_direct) throw new Error('This was sent straight to another device of yours, so it can only be opened there.')
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(mediaPath(this.store.spaceId, message.id))
    if (error || !data) throw new Error('This was already opened, or it expired.')
    return data.arrayBuffer()
  }

  private async sweepStorage(messagesById: Map<string, StoredMessage>): Promise<number> {
    const bucket = supabase.storage.from(MEDIA_BUCKET)
    const { data: files } = await bucket.list(this.store.spaceId, { limit: 1000 })
    const stalePaths: string[] = []
    for (const file of files ?? []) {
      // Each file is named after its message's id.
      const message = messagesById.get(file.name)
      let stale = false
      if (message) stale = Boolean(message.media_opened_at) || isExpired(message.created_at)
      else if (file.created_at) stale = isExpired(file.created_at)
      if (stale) stalePaths.push(mediaPath(this.store.spaceId, file.name))
    }
    if (stalePaths.length) await bucket.remove(stalePaths)
    return stalePaths.length
  }

  /** The phone's waiting files are shared by every space, so a file whose message isn't loaded here may belong to
   * another space: it's only removed once it expires. */
  private async sweepInbox(messagesById: Map<string, StoredMessage>): Promise<number> {
    let removed = 0
    for (const file of await inbox.list().catch(() => [])) {
      const message = messagesById.get(file.messageId)
      const expired = isExpired(new Date(file.receivedAt).toISOString())
      const openedHere = message !== undefined && (Boolean(message.media_opened_at) || isExpired(message.created_at))
      const gone = expired || openedHere
      if (!gone) continue
      await inbox.remove(file.messageId).catch(() => {})
      removed++
    }
    return removed
  }
}
