// Invite links: https://<app>/join#ABCD-EFGH opens the app and joins that
// space once you're signed in, so your person never types the code.
//
// The code sits after the #, which browsers never send to a server, so it
// isn't in Cloudflare's logs or anyone's Referer. The app reads it once,
// keeps it on this device until it's used (it has to survive signing up and
// confirming an email), and clears it from the address bar straight away.
// The link only gets someone into the space while the code is unused, and
// never carries the passphrase: that's still shared in person.

const STORE_KEY = 'duo:invite'
/** Unused invites are forgotten after this. */
const KEEP_MS = 14 * 86_400_000
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

export const pendingInvite = {
  get(now = Date.now()): string | null {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { code?: unknown; at?: unknown } | null
      if (!saved || typeof saved.code !== 'string' || typeof saved.at !== 'number') return null
      if (now - saved.at > KEEP_MS) {
        localStorage.removeItem(STORE_KEY)
        return null
      }
      return normalizeCode(saved.code)
    } catch {
      return null
    }
  },
  set(code: string) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ code, at: Date.now() }))
    } catch {
      // no storage: the link still works if they're already signed in
    }
  },
  clear() {
    try {
      localStorage.removeItem(STORE_KEY)
    } catch {
      // nothing saved
    }
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
