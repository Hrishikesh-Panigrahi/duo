// Turning encryption on, unlocking and locking this device, and the one-time upgrade of older rows.
import { contexts, deriveKey, encryptMessage, keyMatches, makeKeyCheck, newSalt, type MessageContent } from '../e2e'
import { deviceStorage } from '../device-storage'
import { keystore } from '../keystore'
import { must, supabase } from '../supabase'
import type { StoredMessage } from '../types'
import type { NameActions } from './content-actions'
import { StoreActions, type RowWriter, type StoreDeps } from './store-actions'
import { legacy, type Table } from './rows'
import { cacheKey } from './view'

// Only the device that turns encryption on upgrades older rows: after that, a row without ciphertext was
// written around the app and is never adopted. It's noted on the device, out of the server's reach.
class UpgradeFlag {
  // Without storage the upgrade still runs once, right after setup.
  private owedThisSession = false
  private readonly storageKey: string

  constructor(spaceId: string) {
    this.storageKey = `duo:upgrade:${spaceId}`
  }

  isOwed(): boolean {
    return this.owedThisSession || deviceStorage.get(this.storageKey) === '1'
  }

  markOwed() {
    this.owedThisSession = true
    deviceStorage.set(this.storageKey, '1')
  }

  clear() {
    this.owedThisSession = false
    deviceStorage.remove(this.storageKey)
  }
}

/** A row from before encryption, and what to seal it as. */
type LegacyUpgrade = { table: Exclude<Table, 'messages'>; id: string; context: string; content: unknown }

export class EncryptionActions extends StoreActions {
  private readonly upgradeFlag: UpgradeFlag

  constructor(
    store: StoreDeps,
    writer: RowWriter,
    private readonly names: NameActions,
  ) {
    super(store, writer)
    this.upgradeFlag = new UpgradeFlag(store.spaceId)
  }

  /** Turns on end-to-end encryption for the space, with a passphrase you both know. */
  async setUp(passphrase: string) {
    const { spaceId } = this.store
    this.upgradeFlag.markOwed()
    const salt = newSalt()
    const key = await deriveKey(passphrase, salt)
    const check = await makeKeyCheck(key, spaceId)
    try {
      await must(supabase.rpc('enable_e2e', { salt, check_value: check }))
    } catch (e) {
      // Someone else turned it on first, so this device mustn't upgrade anything.
      this.upgradeFlag.clear()
      throw e
    }
    this.store.setSpace((space) => space && { ...space, e2e_salt: salt, e2e_check: check })
    await keystore.set(spaceId, key).catch(() => {})
    this.store.setKey(key)
  }

  /** Throws if it's not the right passphrase. */
  async unlock(passphrase: string) {
    const { spaceId } = this.store
    const space = this.store.space.current
    if (!space?.e2e_salt || !space.e2e_check) throw new Error('Encryption is not set up yet.')
    const key = await deriveKey(passphrase, space.e2e_salt)
    if (!(await keyMatches(key, spaceId, space.e2e_check))) throw new Error('That passphrase does not match.')
    await keystore.set(spaceId, key).catch(() => {})
    this.store.setKey(key)
  }

  /** Forgets the key on this device; everything stays encrypted until it's unlocked again. */
  async lock() {
    await keystore.remove(this.store.spaceId).catch(() => {})
    this.store.setKey(null)
    this.store.forgetPlaintext()
  }

  /** Right after this device turns encryption on, encrypts everything saved before. Returns how many rows. */
  async upgradeLegacy(): Promise<number> {
    const key = this.writer.requireKey()
    if (!this.upgradeFlag.isOwed()) return 0
    const count = (await this.upgradeNames()) + (await this.upgradeRecords()) + (await this.upgradeMessages(key))
    this.upgradeFlag.clear()
    return count
  }

  private async upgradeNames(): Promise<number> {
    let count = 0
    const space = this.store.space.current
    if (space && !space.name_cipher && space.name !== null) {
      await this.names.renameSpace(space.name)
      count++
    }
    const me = this.store.members.current.find((m) => m.user_id === this.store.userId)
    if (me && !me.display_name_cipher && me.display_name !== null) {
      await this.names.renameMe(me.display_name)
      count++
    }
    return count
  }

  private async upgradeRecords(): Promise<number> {
    const { spaceId } = this.store
    const { contacts, notes, lists, list_items } = this.store.rows.current
    const upgrades: LegacyUpgrade[] = []
    for (const contact of contacts) {
      if (contact.cipher) continue
      const context = contexts.contact(spaceId, contact.id)
      upgrades.push({ table: 'contacts', id: contact.id, context, content: legacy.contact(contact) })
    }
    for (const note of notes) {
      if (note.cipher) continue
      const context = contexts.note(spaceId, note.id)
      upgrades.push({ table: 'notes', id: note.id, context, content: legacy.note(note) })
    }
    for (const list of lists) {
      if (list.cipher) continue
      const context = contexts.list(spaceId, list.id)
      upgrades.push({ table: 'lists', id: list.id, context, content: legacy.list(list) })
    }
    for (const item of list_items) {
      if (item.cipher) continue
      const context = contexts.item(spaceId, item.list_id, item.id)
      upgrades.push({ table: 'list_items', id: item.id, context, content: legacy.item(item) })
    }
    for (const { table, id, context, content } of upgrades) await this.writer.updateSealed(table, id, context, content)
    return upgrades.length
  }

  /** Messages can't be edited, so each of ours is swapped for an encrypted copy in one server-side step. */
  private async upgradeMessages(key: CryptoKey): Promise<number> {
    const { spaceId, userId } = this.store
    const mine = this.store.rows.current.messages.filter((m) => !m.cipher && m.sender_id === userId && !m.pending)
    for (const message of mine) {
      const ids = { spaceId, senderId: userId, messageId: crypto.randomUUID() }
      const content: MessageContent = { body: message.body ?? null, contact: message.contact ?? null, media: null }
      const cipher = await encryptMessage(key, ids, content)
      this.store.remember([[cacheKey(contexts.message(ids), cipher), content]])
      await must(supabase.rpc('encrypt_legacy_message', { old_id: message.id, new_id: ids.messageId, new_cipher: cipher }))
      const row: StoredMessage = { ...message, id: ids.messageId, cipher, body: null, contact: null }
      this.store.dispatch({ type: 'confirm', table: 'messages', replacedId: message.id, row })
    }
    return mine.length
  }
}
