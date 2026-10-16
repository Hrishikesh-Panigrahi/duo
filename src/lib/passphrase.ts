// Whoever copies the database can guess passphrases offline. PBKDF2 makes each guess slow;
// only a passphrase nobody would guess makes guessing hopeless.
import { MIN_PASSPHRASE_LENGTH } from './e2e'

// The first things anyone tries. Stripped out before judging what's left.
const COMMON = [
  'password', 'passw0rd', 'qwerty', 'azerty', 'asdf', 'zxcv', 'letmein', 'welcome', 'admin', 'iloveyou',
  'loveyou', 'love', 'forever', 'baby', 'babygirl', 'sweetheart', 'honey', 'princess', 'sunshine', 'monkey',
  'dragon', 'master', 'shadow', 'superman', 'football', 'cricket', 'secret', 'trustno1', 'together', 'always',
]
const RUNS = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

/** Drops ascending or descending runs of 3+ (abc, 321, qwe) from `s`. */
function dropRuns(s: string): string {
  let out = s
  for (const run of RUNS) {
    for (const seq of [run, [...run].reverse().join('')]) {
      for (let len = seq.length; len >= 3; len--) {
        for (let i = 0; i + len <= seq.length; i++) out = out.split(seq.slice(i, i + len)).join('')
      }
    }
  }
  return out
}

/** Why a passphrase is too weak to protect the space, or null if it's fine. */
export function passphraseProblem(passphrase: string): string | null {
  const p = passphrase.normalize('NFKC')
  if ([...p].length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters. Four or five random words works well.`
  }
  const letters = p.toLowerCase().replace(/[\s\p{P}\p{S}_]/gu, '')
  if (new Set(letters).size < 6) return 'That repeats the same few characters. Try four or five random words.'
  if (/^\d+$/.test(letters)) return 'Use words, not just numbers.'
  let rest = letters
  for (const w of COMMON) rest = rest.split(w).join('')
  rest = dropRuns(rest).replace(/(.)\1+/gu, '$1')
  // Years and dates are among the first guesses too.
  rest = rest.replace(/(19|20)\d\d/g, '')
  if ([...rest].length < 10) return "That's one of the first things someone would guess. Try four or five random words."
  return null
}

// No look-alikes (0/O, 1/l/I), so it's easy to read off one phone and type into the other.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** A random passphrase like "k7mpx-2rtwq-9hnze-b4fya": about 100 bits, far beyond guessing. */
export function suggestPassphrase(): string {
  const groups: string[] = []
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  for (let g = 0; g < 4; g++) {
    // 256 is a multiple of 32, so every character is equally likely.
    groups.push([...bytes.subarray(g * 5, g * 5 + 5)].map((b) => ALPHABET[b % ALPHABET.length]).join(''))
  }
  return groups.join('-')
}
