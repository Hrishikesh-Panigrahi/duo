// Chat: messages, contact cards, and view-once photos and videos.
//
// A photo or video goes straight to the other phone when both apps are open
// (see room.ts and direct.ts); only when that isn't possible does it wait in
// Storage, encrypted, for up to MEDIA_TTL_DAYS.
import { contexts, decryptBytes, encryptBytes, encryptMessage, type MessageContent, type MessageIds } from '../e2e'
import { inbox } from '../inbox'
import { isExpired, mediaPath, prepareMedia } from '../media'
import { must, serverError, supabase } from '../supabase'
import { toCard, type Message, type StoredMessage } from '../types'
import type { ContactCard } from '../vcard'
import { MESSAGE_LIMIT, time, type AnyRow } from './rows'
import type { Records, StoreDeps } from './records'
import { cacheKey } from './view'

const MEDIA_BUCKET = 'media'
/** A directly delivered file whose message never arrived is dropped after this. */
const ORPHAN_GRACE_MS = 10 * 60_000

export function chatActions(d: StoreDeps, r: Records) {
  const media = () => supabase.storage.from(MEDIA_BUCKET)

  /**
   * Encrypts and sends a message. `beforeInsert` runs once its id is known
   * (to deliver a file) and can add fields to the saved row.
   */
  async function sendContent(
    content: MessageContent,
    extra: Record<string, unknown> = {},
    beforeInsert?: (id: string, ids: MessageIds) => Promise<Record<string, unknown>>,
  ) {
    const key = r.requireKey()
    // The id is chosen here so it can be sealed into the ciphertext.
    const id = crypto.randomUUID()
    const ids: MessageIds = { spaceId: d.spaceId, senderId: d.userId, messageId: id }
    const cipher = await encryptMessage(key, ids, content)
    d.remember([[cacheKey(contexts.message(ids), cipher), content]])
    const temp: StoredMessage = { id, space_id: d.spaceId, sender_id: d.userId, created_at: r.now(), cipher, pending: true, ...extra }
    r.upsert('messages', temp)
    try {
      const more = (await beforeInsert?.(id, ids)) ?? {}
      const row = await must<StoredMessage>(
        supabase.from('messages').insert({ id, space_id: d.spaceId, cipher, ...extra, ...more }).select().single(),
      )
      d.dispatch({ type: 'confirm', table: 'messages', tempId: id, row })
    } catch (e) {
      r.remove('messages', id)
      throw e
    }
  }

  return {
    sendMessage(input: { body?: string; contact?: ContactCard }) {
      return sendContent({ body: input.body?.trim() || null, contact: input.contact ? toCard(input.contact) : null, media: null })
    },

    /**
     * Sends a view-once photo or video, encrypted here. If your person's app
     * is open it goes straight to their phone and is never stored anywhere
     * else; if not, it waits in Storage (still encrypted) until it's opened
     * or expires.
     */
    async sendMedia(file: File) {
      const { bytes, info } = await prepareMedia(file)
      const key = r.requireKey()
      const uploaded = { path: '' }
      try {
        await sendContent({ body: null, contact: null, media: info }, { has_media: true }, async (id, ids) => {
          const encrypted = await encryptBytes(key, contexts.media(ids), bytes)
          const partnerId = d.members.current.find((m) => m.user_id !== d.userId)?.user_id
          const room = d.room.current
          if (room && partnerId && room.partnerCanTakeFile()) {
            try {
              await room.sendFile(partnerId, id, encrypted)
              return { media_direct: true }
            } catch (e) {
              if (import.meta.env.DEV) console.info('Direct delivery failed; using encrypted Storage instead.', e)
            }
          }
          const path = mediaPath(d.spaceId, id)
          const { error } = await media().upload(path, new Blob([encrypted], { type: 'application/octet-stream' }), {
            contentType: 'application/octet-stream',
            upsert: false,
          })
          if (error) throw serverError(error)
          uploaded.path = path
          return { media_direct: false }
        })
      } catch (e) {
        // Don't leave an encrypted file behind for a message that was never saved.
        if (uploaded.path) await media().remove([uploaded.path]).catch(() => {})
        throw e
      }
    },

    /** Decrypts a photo or video; returns a URL that only works on this page. */
    async openMedia(m: Message): Promise<string> {
      const key = r.requireKey()
      let encrypted = await inbox.get(m.id).catch(() => undefined)
      if (!encrypted) {
        if (m.media_direct) {
          throw new Error('This was sent straight to another device of yours, so it can only be opened there.')
        }
        const { data, error } = await media().download(mediaPath(d.spaceId, m.id))
        if (error || !data) throw new Error('This was already opened, or it expired.')
        encrypted = await data.arrayBuffer()
      }
      const ids = { spaceId: d.spaceId, senderId: m.sender_id, messageId: m.id }
      const bytes = await decryptBytes(key, contexts.media(ids), encrypted)
      return URL.createObjectURL(new Blob([bytes], { type: m.media?.mime ?? 'application/octet-stream' }))
    },

    /** Deletes a photo or video's file, wherever it was, and marks it opened. */
    async finishMedia(m: Message) {
      // Deleting comes first: even if marking it opened fails, there's no second look.
      await inbox.remove(m.id).catch(() => {})
      if (!m.media_direct) await media().remove([mediaPath(d.spaceId, m.id)]).catch(() => {})
      await must(supabase.rpc('mark_media_opened', { message_id: m.id }))
      const row = d.rows.current.messages.find((x) => x.id === m.id)
      if (row) r.upsert('messages', { ...row, media_opened_at: r.now() } as AnyRow)
    },

    /** Deletes files that were opened or expired, or whose message is gone, in Storage and on this device. */
    async sweepMedia(): Promise<number> {
      const messages = d.rows.current.messages
      const byId = new Map(messages.map((x) => [x.id, x]))
      const finished = (m: StoredMessage) => Boolean(m.media_opened_at) || isExpired(m.created_at)

      const { data } = await media().list(d.spaceId, { limit: 1000 })
      const stale = (data ?? [])
        .filter((obj) => {
          const m = byId.get(obj.name)
          if (!m) return obj.created_at ? isExpired(obj.created_at) : false
          return finished(m)
        })
        .map((obj) => mediaPath(d.spaceId, obj.name))
      if (stale.length) await media().remove(stale)

      // A message older than everything loaded could still exist, so only
      // call a delivered file orphaned when its time is covered.
      const covered = (at: number) => messages.length < MESSAGE_LIMIT || (messages[0] && time(messages[0].created_at) < at)
      let local = 0
      for (const e of await inbox.list().catch(() => [])) {
        const m = byId.get(e.messageId)
        const gone = m
          ? finished(m)
          : isExpired(new Date(e.receivedAt).toISOString()) || (covered(e.receivedAt) && Date.now() - e.receivedAt > ORPHAN_GRACE_MS)
        if (!gone) continue
        await inbox.remove(e.messageId).catch(() => {})
        local++
      }
      return stale.length + local
    },

    async deleteMessage(id: string) {
      const row = d.rows.current.messages.find((x) => x.id === id)
      await r.del('messages', id)
      await inbox.remove(id).catch(() => {})
      if (row?.has_media && !row.media_direct) await media().remove([mediaPath(d.spaceId, id)])
    },

    /** Throttled "is typing" ping to the other person. */
    typing() {
      d.room.current?.typing()
    },
  }
}
