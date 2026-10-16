// End-to-end encryption for chat messages.
//
// Both people type the same passphrase on each of their devices. PBKDF2 turns
// it into an AES-256-GCM key that stays on the device; the server only ever
// sees ciphertext and a random salt. Each message's ciphertext is bound to its
// space, sender and id, so someone with database access can't move or replay it.
import type { ContactCard } from './vcard'

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
export type MessageContent = { body: string | null; contact: ContactCard | null }

const messageContext = ({ spaceId, senderId, messageId }: MessageIds) => `duo:msg:${spaceId}:${senderId}:${messageId}`

export function encryptMessage(key: CryptoKey, ids: MessageIds, content: MessageContent): Promise<string> {
  return seal(key, JSON.stringify({ b: content.body, c: content.contact }), messageContext(ids))
}

/** Throws if the key is wrong or the ciphertext was tampered with or moved. */
export async function decryptMessage(key: CryptoKey, ids: MessageIds, cipher: string): Promise<MessageContent> {
  const parsed = JSON.parse(await open(key, cipher, messageContext(ids))) as { b?: string | null; c?: ContactCard | null }
  return { body: parsed.b ?? null, contact: parsed.c ?? null }
}
