// Whoever copies the database can guess passphrases offline. PBKDF2 makes each guess slow;
// only a passphrase nobody would guess makes guessing hopeless.
import { MIN_PASSPHRASE_LENGTH } from './e2e'

// The first things anyone tries. Stripped out before judging what's left.
const COMMON_PASSWORDS = [
  'password', 'passw0rd', 'qwerty', 'azerty', 'asdf', 'zxcv', 'letmein', 'welcome', 'admin', 'iloveyou',
  'loveyou', 'love', 'forever', 'baby', 'babygirl', 'sweetheart', 'honey', 'princess', 'sunshine', 'monkey',
  'dragon', 'master', 'shadow', 'superman', 'football', 'cricket', 'secret', 'trustno1', 'together', 'always',
]
const RUNS = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const SPACES_PUNCTUATION_SYMBOLS = /[\s\p{P}\p{S}_]/gu
const REPEATED_CHARACTER = /(.)\1+/gu

/** Drops ascending or descending runs of 3+ (abc, 321, qwe) from `text`. */
function dropRuns(text: string): string {
  let remaining = text
  for (const run of RUNS) {
    for (const sequence of [run, [...run].reverse().join('')]) {
      for (let length = sequence.length; length >= 3; length--) {
        for (let i = 0; i + length <= sequence.length; i++) remaining = remaining.replaceAll(sequence.slice(i, i + length), '')
      }
    }
  }
  return remaining
}

/** Why a passphrase is too weak to protect the space, or null if it's fine. */
export function passphraseProblem(passphrase: string): string | null {
  const normalized = passphrase.normalize('NFKC')
  if ([...normalized].length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters. Four or five random words works well.`
  }
  const lettersAndDigits = normalized.toLowerCase().replace(SPACES_PUNCTUATION_SYMBOLS, '')
  if (new Set(lettersAndDigits).size < 6) return 'That repeats the same few characters. Try four or five random words.'
  if (/^\d+$/.test(lettersAndDigits)) return 'Use words, not just numbers.'
  let unguessable = lettersAndDigits
  for (const word of COMMON_PASSWORDS) unguessable = unguessable.replaceAll(word, '')
  unguessable = dropRuns(unguessable).replace(REPEATED_CHARACTER, '$1')
  // Years and dates are among the first guesses too.
  unguessable = unguessable.replace(/(19|20)\d\d/g, '')
  if ([...unguessable].length < 10) return "That's one of the first things someone would guess. Try four or five random words."
  return null
}

// No look-alikes (0/O, 1/l/I), so it's easy to read off one phone and type into the other.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const GROUPS = 4
const GROUP_LENGTH = 5

/** A random passphrase like "k7mpx-2rtwq-9hnze-b4fya": about 100 bits, far beyond guessing. */
export function suggestPassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GROUPS * GROUP_LENGTH))
  let passphrase = ''
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0 && i % GROUP_LENGTH === 0) passphrase += '-'
    // 256 is a multiple of 32, so every character is equally likely.
    passphrase += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return passphrase
}
