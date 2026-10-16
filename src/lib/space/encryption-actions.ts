// Turning encryption on, unlocking and locking this device, and the one-time
// upgrade of whatever was saved before encryption.
import { contexts, deriveKey, encryptMessage, keyMatches, makeCheck, newSalt, type MessageContent } from '../e2e'
import { keystore } from '../keystore'
import { must, supabase } from '../supabase'
import type { StoredMessage } from '../types'
import { legacy } from './rows'
import type { ContentActions } from './content-actions'
import type { Records, StoreDeps } from './records'
import { cacheKey } from './view'

// Once a space is encrypted, a row without ciphertext can only have been
// written around the app, by someone with access to the database. Such rows
// are never shown (see view.ts), and never encrypted as if they were yours.
//
// The one exception is the moment encryption is turned on: the device that
// does it encrypts what was saved before. It notes that on itself (where the
// server can't), so only it ever does, and it can finish if interrupted.
const upgradeKey = (spaceId: string) => `duo:upgrade:${spaceId}`
export const upgradeFlag = {
  get(spaceId: string): boolean {
    try {
      return localStorage.getItem(upgradeKey(spaceId)) === '1'
    } catch {
      return false
    }
  },
  set(spaceId: string, on: boolean) {
    try {
      if (on) localStorage.setItem(upgradeKey(spaceId), '1')
      else localStorage.removeItem(upgradeKey(spaceId))
    } catch {
      // no storage: the upgrade still runs once, right after setup
    }
  },
}

export function encryptionActions(d: StoreDeps, r: Records, content: Pick<ContentActions, 'renameSpace' | 'renameMe'>) {
  const { spaceId, userId } = d

  return {
    /** Turns on end-to-end encryption for the space, with a passphrase you both know. */
    async setUpEncryption(passphrase: string) {
      d.upgradePending.current = true
      upgradeFlag.set(spaceId, true)
      const salt = newSalt()
      const key = await deriveKey(passphrase, salt)
      const check = await makeCheck(key, spaceId)
      try {
        await must(supabase.rpc('enable_e2e', { salt, check_value: check }))
      } catch (e) {
        // Someone else turned it on first, so this device mustn't upgrade anything.
        d.upgradePending.current = false
        upgradeFlag.set(spaceId, false)
        throw e
      }
      d.setSpace((s) => s && { ...s, e2e_salt: salt, e2e_check: check })
      await keystore.set(spaceId, key).catch(() => {})
      d.setKey(key)
    },

    /** Unlocks this device with the passphrase. Throws if it's not the right one. */
    async unlockEncryption(passphrase: string) {
      const s = d.space.current
      if (!s?.e2e_salt || !s.e2e_check) throw new Error('Encryption is not set up yet.')
      const key = await deriveKey(passphrase, s.e2e_salt)
      if (!(await keyMatches(key, spaceId, s.e2e_check))) throw new Error('That passphrase does not match.')
      await keystore.set(spaceId, key).catch(() => {})
      d.setKey(key)
    },

    /** Forgets the key on this device; everything stays encrypted until it's unlocked again. */
    async lockDevice() {
      await keystore.remove(spaceId).catch(() => {})
      d.setKey(null)
      d.forgetPlaintext()
    },

    /**
     * Right after this device turns encryption on, encrypts anything saved
     * before: the space name, your own name and messages, and every contact,
     * note and list. Does nothing on any other device. Returns how many rows
     * were upgraded.
     */
    async upgradeLegacy(): Promise<number> {
      const key = r.requireKey()
      if (!d.upgradePending.current && !upgradeFlag.get(spaceId)) return 0
      let count = 0
      const s = d.space.current
      if (s && !s.name_cipher && s.name !== null) {
        await content.renameSpace(s.name)
        count++
      }
      const me = d.members.current.find((m) => m.user_id === userId)
      if (me && !me.display_name_cipher && me.display_name !== null) {
        await content.renameMe(me.display_name)
        count++
      }
      const rows = d.rows.current
      for (const c of rows.contacts.filter((x) => !x.cipher)) {
        await r.updateSealed('contacts', c.id, await r.seal(contexts.contact(spaceId, c.id), legacy.contact(c)))
        count++
      }
      for (const n of rows.notes.filter((x) => !x.cipher)) {
        await r.updateSealed('notes', n.id, await r.seal(contexts.note(spaceId, n.id), legacy.note(n)))
        count++
      }
      for (const l of rows.lists.filter((x) => !x.cipher)) {
        await r.updateSealed('lists', l.id, await r.seal(contexts.list(spaceId, l.id), legacy.list(l)))
        count++
      }
      for (const i of rows.list_items.filter((x) => !x.cipher)) {
        await r.updateSealed('list_items', i.id, await r.seal(contexts.item(spaceId, i.list_id, i.id), legacy.item(i)))
        count++
      }
      // Messages can't be edited, so each of ours is swapped for an encrypted
      // copy in one server-side step.
      for (const m of rows.messages.filter((x) => !x.cipher && x.sender_id === userId && !x.pending)) {
        const newId = crypto.randomUUID()
        const ids = { spaceId, senderId: userId, messageId: newId }
        const message: MessageContent = { body: m.body ?? null, contact: m.contact ?? null, media: null }
        const cipher = await encryptMessage(key, ids, message)
        d.remember([[cacheKey(contexts.message(ids), cipher), message]])
        await must(supabase.rpc('encrypt_legacy_message', { old_id: m.id, new_id: newId, new_cipher: cipher }))
        const replacement: StoredMessage = { ...m, id: newId, cipher, body: null, contact: null }
        d.dispatch({ type: 'confirm', table: 'messages', tempId: m.id, row: replacement })
        count++
      }
      d.upgradePending.current = false
      upgradeFlag.set(spaceId, false)
      return count
    },
  }
}
