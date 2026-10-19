// The spaces this account is in: which one the app opens, and what the space switcher shows for each.
// Names are decrypted with each space's own key on this device; a space whose key isn't here shows as locked.
import { contexts, decryptRecord } from './e2e'
import { deviceStorage } from './device-storage'
import { keystore } from './keystore'
import { must, supabase } from './supabase'
import { shapes } from './space/shapes'
import type { StoredMember, StoredSpace } from './types'

const LAST_OPENED_KEY = 'duo:space'

/** Where the time you last read a space's chat is kept on this device. */
export const lastReadKey = (spaceId: string) => `duo:lastRead:${spaceId}`

export const lastOpenedSpace = {
  get: () => deviceStorage.get(LAST_OPENED_KEY),
  set: (spaceId: string) => deviceStorage.set(LAST_OPENED_KEY, spaceId),
}

/** The space to open: the one last opened on this device while it's still yours, otherwise your oldest. */
export function spaceToOpen(spaceIds: string[], lastOpened: string | null): string | null {
  if (lastOpened && spaceIds.includes(lastOpened)) return lastOpened
  return spaceIds[0] ?? null
}

/** Oldest first. */
export async function loadMySpaceIds(userId: string): Promise<string[]> {
  const memberships = await must<{ space_id: string }[]>(supabase.from('members').select('space_id').eq('user_id', userId).order('joined_at'))
  return memberships.map((membership) => membership.space_id)
}

export type SpaceSummary = {
  id: string
  /** Null until it's set, or while the space is locked on this device. */
  name: string | null
  partnerName: string | null
  hasPartner: boolean
  /** Encryption is on, but this device doesn't have the key. */
  locked: boolean
  unread: number
}

export async function loadSpaceSummaries(spaceIds: string[], userId: string): Promise<SpaceSummary[]> {
  if (spaceIds.length === 0) return []
  const [spaces, members] = await Promise.all([
    must<StoredSpace[]>(supabase.from('spaces').select('*').in('id', spaceIds)),
    must<StoredMember[]>(supabase.from('members').select('*').in('space_id', spaceIds)),
  ])
  const summaries: SpaceSummary[] = []
  for (const spaceId of spaceIds) {
    const space = spaces.find((row) => row.id === spaceId)
    const partner = members.find((member) => member.space_id === spaceId && member.user_id !== userId)
    summaries.push(await summarise(spaceId, space, partner, userId))
  }
  return summaries
}

async function summarise(spaceId: string, space: StoredSpace | undefined, partner: StoredMember | undefined, userId: string): Promise<SpaceSummary> {
  const encryptionOn = Boolean(space?.e2e_salt)
  const key = await keystore.get(spaceId).catch(() => undefined)
  const name = await readName(key, contexts.spaceName(spaceId), space?.name_cipher, space?.name, encryptionOn)
  const partnerName = partner
    ? await readName(key, contexts.memberName(spaceId, partner.user_id), partner.display_name_cipher, partner.display_name, encryptionOn)
    : null
  const unread = await countUnread(spaceId, userId)
  return { id: spaceId, name, partnerName, hasPartner: Boolean(partner), locked: encryptionOn && !key, unread }
}

/** A name, decrypted if it's encrypted. Plaintext from before encryption only counts while encryption is off. */
async function readName(key: CryptoKey | undefined, context: string, cipher: string | null | undefined, plaintext: string | null | undefined, encryptionOn: boolean) {
  if (!cipher) return encryptionOn ? null : (plaintext ?? null)
  if (!key) return null
  try {
    const name = await decryptRecord<unknown>(key, context, cipher)
    return shapes.name(name) ? (name as string) : null
  } catch {
    return null
  }
}

/** Their messages since you last read this space's chat on this device; none if you never have here. */
async function countUnread(spaceId: string, userId: string): Promise<number> {
  const lastRead = deviceStorage.get(lastReadKey(spaceId))
  if (!lastRead) return 0
  const query = supabase.from('messages').select('id', { count: 'exact', head: true })
  const { count } = await query.eq('space_id', spaceId).neq('sender_id', userId).gt('created_at', lastRead)
  return count ?? 0
}
