// Turning encryption on, unlocking and locking this device, and the one-time upgrade of older rows.
import { contexts, deriveKey, encryptMessage, keyMatches, makeCheck, newSalt, type MessageContent } from '../e2e'
import { deviceStorage } from '../device-storage'
import { keystore } from '../keystore'
import { must, supabase } from '../supabase'
import type { StoredMessage } from '../types'
import type { NameActions } from './content-actions'
import { StoreActions, type Records, type StoreDeps } from './records'
import { legacy, type Table } from './rows'
import { cacheKey } from './view'

// Only the device that turns encryption on upgrades older rows: after that, a row without ciphertext was
// written around the app and is never adopted. It's noted on the device, out of the server's reach.
class UpgradeFlag {
  private pending = false
  private readonly storageKey: string

  constructor(spaceId: string) {
    this.storageKey = `duo:upgrade:${spaceId}`
  }

  get owed(): boolean {
    return this.pending || deviceStorage.get(this.storageKey) === '1'
  }

  // Without storage the upgrade still runs once, right after setup.
  set owed(owed: boolean) {
    this.pending = owed
    if (owed) deviceStorage.set(this.storageKey, '1')
    else deviceStorage.remove(this.storageKey)
  }
}

export class EncryptionActions extends StoreActions {
  private readonly upgrade: UpgradeFlag

  constructor(
    store: StoreDeps,
    records: Records,
    private readonly names: NameActions,
  ) {
    super(store, records)
    this.upgrade = new UpgradeFlag(store.spaceId)
  }

  /** Turns on end-to-end encryption for the space, with a passphrase you both know. */
  async setUp(passphrase: string) {
    const { spaceId } = this.store
    this.upgrade.owed = true
    const salt = newSalt()
    const key = await deriveKey(passphrase, salt)
    const check = await makeCheck(key, spaceId)
    try {
      await must(supabase.rpc('enable_e2e', { salt, check_value: check }))
    } catch (e) {
      // Someone else turned it on first, so this device mustn't upgrade anything.
      this.upgrade.owed = false
      throw e
    }
    this.store.setSpace((s) => s && { ...s, e2e_salt: salt, e2e_check: check })
    await keystore.set(spaceId, key).catch(() => {})
    this.store.setKey(key)
  }

  /** Throws if it's not the right passphrase. */
  async unlock(passphrase: string) {
    const { spaceId } = this.store
    const s = this.store.space.current
    if (!s?.e2e_salt || !s.e2e_check) throw new Error('Encryption is not set up yet.')
    const key = await deriveKey(passphrase, s.e2e_salt)
    if (!(await keyMatches(key, spaceId, s.e2e_check))) throw new Error('That passphrase does not match.')
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
    const key = this.records.requireKey()
    if (!this.upgrade.owed) return 0
    const count = (await this.upgradeNames()) + (await this.upgradeRecords()) + (await this.upgradeMessages(key))
    this.upgrade.owed = false
    return count
  }

  private async upgradeNames(): Promise<number> {
    let count = 0
    const s = this.store.space.current
    if (s && !s.name_cipher && s.name !== null) {
      await this.names.renameSpace(s.name)
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
    const upgrades: (readonly [Exclude<Table, 'messages'>, string, string, unknown])[] = [
      ...contacts.filter((c) => !c.cipher).map((c) => ['contacts', c.id, contexts.contact(spaceId, c.id), legacy.contact(c)] as const),
      ...notes.filter((n) => !n.cipher).map((n) => ['notes', n.id, contexts.note(spaceId, n.id), legacy.note(n)] as const),
      ...lists.filter((l) => !l.cipher).map((l) => ['lists', l.id, contexts.list(spaceId, l.id), legacy.list(l)] as const),
      ...list_items
        .filter((i) => !i.cipher)
        .map((i) => ['list_items', i.id, contexts.item(spaceId, i.list_id, i.id), legacy.item(i)] as const),
    ]
    for (const [table, id, context, content] of upgrades) await this.records.updateSealed(table, id, context, content)
    return upgrades.length
  }

  /** Messages can't be edited, so each of ours is swapped for an encrypted copy in one server-side step. */
  private async upgradeMessages(key: CryptoKey): Promise<number> {
    const { spaceId, userId } = this.store
    const mine = this.store.rows.current.messages.filter((m) => !m.cipher && m.sender_id === userId && !m.pending)
    for (const m of mine) {
      const ids = { spaceId, senderId: userId, messageId: crypto.randomUUID() }
      const content: MessageContent = { body: m.body ?? null, contact: m.contact ?? null, media: null }
      const cipher = await encryptMessage(key, ids, content)
      this.store.remember([[cacheKey(contexts.message(ids), cipher), content]])
      await must(supabase.rpc('encrypt_legacy_message', { old_id: m.id, new_id: ids.messageId, new_cipher: cipher }))
      const row: StoredMessage = { ...m, id: ids.messageId, cipher, body: null, contact: null }
      this.store.dispatch({ type: 'confirm', table: 'messages', tempId: m.id, row })
    }
    return mine.length
  }
}
