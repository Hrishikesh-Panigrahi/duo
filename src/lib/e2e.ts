// End-to-end encryption. Both people type the same passphrase; PBKDF2 turns it into an AES-256-GCM key
// that never leaves the device, so the server only ever sees ciphertext and a random salt.
import type { ContactCard } from './vcard'
import type { MediaInfo } from './types'

/** OWASP's recommended work factor for PBKDF2-HMAC-SHA256. */
const ITERATIONS = 600_000
const CHECK_PLAINTEXT = 'duo:key-check:v1'
export const MIN_PASSPHRASE_LENGTH = 12
const SALT_BYTES = 16
/** AES-GCM's standard nonce length. */
const IV_BYTES = 12
/** The authentication tag AES-GCM adds to the end of every ciphertext. */
const GCM_TAG_BYTES = 16

const utf8 = new TextEncoder()
const fromUtf8 = new TextDecoder()

// Spreading a huge array into String.fromCharCode overflows the call stack, so bytes go in chunks of this many.
const BASE64_CHUNK_BYTES = 0x8000

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** WebCrypto only exists on https:// and localhost. */
export const cryptoAvailable = () => typeof crypto !== 'undefined' && typeof crypto.subtle?.deriveKey === 'function'

export function newSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)))
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
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(context) }, key, utf8.encode(plaintext))
  return `v1:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`
}

async function unseal(key: CryptoKey, sealed: string, context: string): Promise<string> {
  const [version, ivBase64, ciphertextBase64] = sealed.split(':')
  if (version !== 'v1' || !ivBase64 || !ciphertextBase64) throw new Error('Unknown encryption format')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivBase64), additionalData: utf8.encode(context) },
    key,
    fromBase64(ciphertextBase64),
  )
  return fromUtf8.decode(plaintext)
}

export const makeKeyCheck = (key: CryptoKey, spaceId: string) => seal(key, CHECK_PLAINTEXT, contexts.check(spaceId))

/** True if this key was derived from the space's passphrase. */
export async function keyMatches(key: CryptoKey, spaceId: string, check: string): Promise<boolean> {
  try {
    return (await unseal(key, check, contexts.check(spaceId))) === CHECK_PLAINTEXT
  } catch {
    return false
  }
}

export type MessageIds = { spaceId: string; senderId: string; messageId: string }
export type MessageContent = { body: string | null; contact: ContactCard | null; media?: MediaInfo | null }

/** Each ciphertext is sealed to what and where it is, so one copied into another row or field won't decrypt. */
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
  /** Proves a key was derived from the space's passphrase. */
  check: (spaceId: string) => `duo:check:${spaceId}`,
}

export function encryptMessage(key: CryptoKey, ids: MessageIds, content: MessageContent): Promise<string> {
  // The short keys b, c and m are part of the stored format: never rename them.
  return seal(key, JSON.stringify({ b: content.body, c: content.contact, m: content.media ?? null }), contexts.message(ids))
}

/** Throws if the key is wrong or the ciphertext was tampered with or moved. */
export async function decryptMessage(key: CryptoKey, ids: MessageIds, cipher: string): Promise<MessageContent> {
  const parsed = JSON.parse(await unseal(key, cipher, contexts.message(ids))) as {
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
  return JSON.parse(await unseal(key, cipher, context)) as T
}

// Files: one version byte, a 12-byte IV, then the AES-GCM ciphertext.
const FILE_VERSION = 1
const FILE_HEADER_BYTES = 1 + IV_BYTES

export async function encryptBytes(key: CryptoKey, context: string, data: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(context) }, key, data))
  const file = new Uint8Array(FILE_HEADER_BYTES + ciphertext.length)
  file[0] = FILE_VERSION
  file.set(iv, 1)
  file.set(ciphertext, FILE_HEADER_BYTES)
  return file
}

export async function decryptBytes(key: CryptoKey, context: string, data: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data)
  if (bytes[0] !== FILE_VERSION || bytes.length < FILE_HEADER_BYTES + GCM_TAG_BYTES) throw new Error('Unknown encrypted file format')
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(1, FILE_HEADER_BYTES), additionalData: utf8.encode(context) },
    key,
    bytes.subarray(FILE_HEADER_BYTES),
  )
}
