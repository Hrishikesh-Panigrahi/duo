// End-to-end encryption for chat messages.
//
// Both people type the same passphrase on each of their devices. PBKDF2 turns
// it into an AES-256-GCM key that stays on the device; the server only ever
// sees ciphertext and a random salt. Each message's ciphertext is bound to its
// space, sender and id, so someone with database access can't move or replay it.
import type { ContactCard } from './vcard'
import type { MediaInfo } from './types'

/** OWASP's recommended work factor for PBKDF2-HMAC-SHA256. */
const ITERATIONS = 600_000
const CHECK_PLAINTEXT = 'duo:key-check:v1'
export const MIN_PASSPHRASE_LENGTH = 12

const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder()

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** WebCrypto only exists on https:// and localhost. */
export const cryptoAvailable = () => typeof crypto !== 'undefined' && typeof crypto.subtle?.deriveKey === 'function'

export function newSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)))
}

/** Non-extractable: the raw key bytes can't be read back out, even by the app. */
export async function deriveKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', utf8.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function seal(key: CryptoKey, plaintext: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(context) }, key, utf8.encode(plaintext))
  return `v1:${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`
}

async function open(key: CryptoKey, sealed: string, context: string): Promise<string> {
  const [version, iv, ct] = sealed.split(':')
  if (version !== 'v1' || !iv || !ct) throw new Error('Unknown encryption format')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: utf8.encode(context) }, key, fromBase64(ct))
  return fromUtf8.decode(pt)
}

const checkContext = (spaceId: string) => `duo:check:${spaceId}`

export const makeCheck = (key: CryptoKey, spaceId: string) => seal(key, CHECK_PLAINTEXT, checkContext(spaceId))

/** True if this key was derived from the space's passphrase. */
export async function keyMatches(key: CryptoKey, spaceId: string, check: string): Promise<boolean> {
  try {
    return (await open(key, check, checkContext(spaceId))) === CHECK_PLAINTEXT
  } catch {
    return false
  }
}

export type MessageIds = { spaceId: string; senderId: string; messageId: string }
export type MessageContent = { body: string | null; contact: ContactCard | null; media?: MediaInfo | null }

/**
 * Every ciphertext is sealed to what it is and where it belongs, so a valid
 * ciphertext copied into another row, list, space or field won't decrypt.
 */
export const contexts = {
  message: ({ spaceId, senderId, messageId }: MessageIds) => `duo:msg:${spaceId}:${senderId}:${messageId}`,
  media: ({ spaceId, senderId, messageId }: MessageIds) => `duo:media:${spaceId}:${senderId}:${messageId}`,
  contact: (spaceId: string, id: string) => `duo:contact:${spaceId}:${id}`,
  note: (spaceId: string, id: string) => `duo:note:${spaceId}:${id}`,
  list: (spaceId: string, id: string) => `duo:list:${spaceId}:${id}`,
  item: (spaceId: string, listId: string, id: string) => `duo:item:${spaceId}:${listId}:${id}`,
  spaceName: (spaceId: string) => `duo:space-name:${spaceId}`,
  memberName: (spaceId: string, userId: string) => `duo:member-name:${spaceId}:${userId}`,
  /** Messages that set up a direct phone-to-phone connection. */
  signal: (spaceId: string) => `duo:signal:${spaceId}`,
}

export function encryptMessage(key: CryptoKey, ids: MessageIds, content: MessageContent): Promise<string> {
  return seal(key, JSON.stringify({ b: content.body, c: content.contact, m: content.media ?? null }), contexts.message(ids))
}

/** Throws if the key is wrong or the ciphertext was tampered with or moved. */
export async function decryptMessage(key: CryptoKey, ids: MessageIds, cipher: string): Promise<MessageContent> {
  const parsed = JSON.parse(await open(key, cipher, contexts.message(ids))) as {
    b?: string | null
    c?: ContactCard | null
    m?: MediaInfo | null
  }
  return { body: parsed.b ?? null, contact: parsed.c ?? null, media: parsed.m ?? null }
}

/** Encrypts any JSON value, sealed to `context` (see `contexts`). */
export function encryptRecord(key: CryptoKey, context: string, value: unknown): Promise<string> {
  return seal(key, JSON.stringify(value), context)
}

export async function decryptRecord<T>(key: CryptoKey, context: string, cipher: string): Promise<T> {
  return JSON.parse(await open(key, cipher, context)) as T
}

// Files: one version byte, a 12-byte IV, then the AES-GCM ciphertext.
const FILE_VERSION = 1

export async function encryptBytes(key: CryptoKey, context: string, data: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(context) }, key, data))
  const out = new Uint8Array(1 + iv.length + ct.length)
  out[0] = FILE_VERSION
  out.set(iv, 1)
  out.set(ct, 1 + iv.length)
  return out
}

export async function decryptBytes(key: CryptoKey, context: string, data: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data)
  if (bytes[0] !== FILE_VERSION || bytes.length < 13 + 16) throw new Error('Unknown encrypted file format')
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(1, 13), additionalData: utf8.encode(context) },
    key,
    bytes.subarray(13),
  )
}
