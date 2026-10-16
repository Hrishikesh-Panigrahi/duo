// Invite links: /join#ABCD-EFGH joins that space once you're signed in. The code sits after the #,
// which browsers never send to a server, and the passphrase is never in the link.

import { MS_PER_DAY } from './dates'
import { deviceStorage } from './device-storage'

const STORE_KEY = 'duo:invite'
/** Unused invites are forgotten after this. */
const KEEP_MS = 14 * MS_PER_DAY
// 8 characters from the same no-look-alikes alphabet the database uses.
const CODE = /^[A-HJKMNP-Z2-9]{8}$/

export const formatCode = (code: string) => code.replace(/^(.{4})(.+)$/, '$1-$2')

/** The code in a typed or linked form ("abcd efgh", "ABCD-EFGH"), or null if it can't be one. */
export function normalizeCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return CODE.test(code) ? code : null
}

export const inviteLink = (code: string, origin = location.origin) => `${origin}/join#${formatCode(code)}`

/** Reads a code from an invite link's address, or null if it isn't one. */
export function codeFromAddress(pathname: string, hash: string): string | null {
  if (pathname.replace(/\/+$/, '') !== '/join') return null
  try {
    return normalizeCode(decodeURIComponent(hash.replace(/^#/, '')))
  } catch {
    return null
  }
}

/** An invite link's code, kept on this device until it's used: it has to survive signing up. */
export const pendingInvite = {
  get(now = Date.now()): string | null {
    let saved: { code?: unknown; at?: unknown } | null
    try {
      saved = JSON.parse(deviceStorage.get(STORE_KEY) ?? 'null')
    } catch {
      return null
    }
    if (!saved || typeof saved.code !== 'string' || typeof saved.at !== 'number') return null
    if (now - saved.at > KEEP_MS) {
      deviceStorage.remove(STORE_KEY)
      return null
    }
    return normalizeCode(saved.code)
  },

  set(code: string) {
    deviceStorage.set(STORE_KEY, JSON.stringify({ code, at: Date.now() }))
  },

  clear() {
    deviceStorage.remove(STORE_KEY)
  },
}

/** Call once at startup: keeps an invite link's code and tidies the address. */
export function captureInvite() {
  const { pathname, hash } = location
  if (pathname.replace(/\/+$/, '') !== '/join') return
  const code = codeFromAddress(pathname, hash)
  if (code) pendingInvite.set(code)
  history.replaceState(null, '', '/')
}
