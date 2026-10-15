// vCard 3.0 in and out: what phones speak when you share or save a contact.
import { NO_YEAR } from './dates'

export type ContactCard = {
  full_name: string
  phones: string[]
  emails: string[]
  company?: string | null
  address?: string | null
  /** YYYY-MM-DD; year NO_YEAR means "year unknown". */
  birthday?: string | null
  notes?: string | null
}

const escapeValue = (s: string) =>
  s.replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m)

const unescapeValue = (s: string) =>
  s.replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))

/** Folds at 75 octets (RFC 6350 §3.2) without splitting a UTF-8 character. */
function fold(line: string): string {
  const enc = new TextEncoder()
  let out = ''
  let chunk = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > limit) {
      out += chunk + '\r\n '
      chunk = ''
      bytes = 0
      limit = 74 // continuation lines spend one octet on the leading space
    }
    chunk += ch
    bytes += n
  }
  return out + chunk
}

export function toVCard(c: ContactCard, opts: { includeNotes?: boolean } = {}): string {
  const name = c.full_name.trim()
  const words = name.split(/\s+/)
  const family = words.length > 1 ? words[words.length - 1] : ''
  const given = words.length > 1 ? words.slice(0, -1).join(' ') : name

  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeValue(family)};${escapeValue(given)};;;`, `FN:${escapeValue(name)}`]
  if (c.company?.trim()) lines.push(`ORG:${escapeValue(c.company.trim())}`)
  for (const p of c.phones) if (p.trim()) lines.push(`TEL;TYPE=CELL:${escapeValue(p.trim())}`)
  for (const e of c.emails) if (e.trim()) lines.push(`EMAIL;TYPE=INTERNET:${escapeValue(e.trim())}`)
  if (c.birthday) {
    lines.push(
      c.birthday.startsWith(`${NO_YEAR}-`) ? `BDAY;X-APPLE-OMIT-YEAR=${NO_YEAR}:${c.birthday}` : `BDAY:${c.birthday}`,
    )
  }
  if (c.address?.trim()) lines.push(`ADR;TYPE=HOME:;;${escapeValue(c.address.trim())};;;;`)
  if (c.notes?.trim() && opts.includeNotes !== false) lines.push(`NOTE:${escapeValue(c.notes.trim())}`)
  lines.push('END:VCARD')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Splits a structured value (N, ADR, ORG) on unescaped semicolons. */
function splitStructured(v: string): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\' && i + 1 < v.length) {
      cur += v[i] + v[i + 1]
      i++
    } else if (v[i] === ';') {
      parts.push(unescapeValue(cur).trim())
      cur = ''
    } else {
      cur += v[i]
    }
  }
  parts.push(unescapeValue(cur).trim())
  return parts
}

function decodeQuotedPrintable(s: string): string {
  const bytes: number[] = []
  const enc = new TextEncoder()
  for (let i = 0; i < s.length; i++) {
    const hex = s.slice(i + 1, i + 3)
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16))
      i += 2
    } else {
      bytes.push(...enc.encode(s[i]))
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

function parseBirthday(raw: string): string | null {
  const v = raw.trim()
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^--(\d{2})-?(\d{2})/.exec(v) // vCard 4 "no year" form
  if (m) return `${NO_YEAR}-${m[1]}-${m[2]}`
  return null
}

type Draft = { fn?: string; n?: string } & Omit<ContactCard, 'full_name'>

/** Parses every card in a .vcf file. Handles vCard 2.1 (Android exports), 3.0 and 4.0. */
export function parseVCards(text: string): ContactCard[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '') // unfold
    .split('\n')

  const cards: ContactCard[] = []
  let cur: Draft | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const colon = line.indexOf(':')
    if (colon < 0) continue

    const [rawName, ...params] = line.slice(0, colon).split(';')
    const prop = rawName.split('.').pop()!.toUpperCase() // drop group prefixes like "item1."
    const upperParams = params.map((p) => p.toUpperCase())
    let value = line.slice(colon + 1)

    if (upperParams.some((p) => p === 'ENCODING=QUOTED-PRINTABLE' || p === 'QUOTED-PRINTABLE')) {
      // vCard 2.1 soft line breaks: a trailing "=" continues onto the next line.
      while (value.endsWith('=') && i + 1 < lines.length) value = value.slice(0, -1) + lines[++i]
      value = decodeQuotedPrintable(value)
    }

    if (prop === 'BEGIN' && value.trim().toUpperCase() === 'VCARD') {
      cur = { phones: [], emails: [] }
      continue
    }
    if (!cur) continue

    switch (prop) {
      case 'END': {
        const n = cur.n ? splitStructured(cur.n) : []
        // N is family;given;additional;prefix;suffix
        const fromN = [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' ')
        const full_name = (cur.fn?.trim() || fromN || cur.company || cur.phones[0] || cur.emails[0] || '').trim()
        if (full_name) {
          cards.push({
            full_name,
            phones: cur.phones,
            emails: cur.emails,
            company: cur.company ?? null,
            address: cur.address ?? null,
            birthday: cur.birthday ?? null,
            notes: cur.notes ?? null,
          })
        }
        cur = null
        break
      }
      case 'FN':
        cur.fn = unescapeValue(value)
        break
      case 'N':
        cur.n = value
        break
      case 'TEL': {
        const tel = unescapeValue(value).replace(/^tel:/i, '').trim()
        if (tel) cur.phones.push(tel)
        break
      }
      case 'EMAIL': {
        const email = unescapeValue(value).replace(/^mailto:/i, '').trim()
        if (email) cur.emails.push(email)
        break
      }
      case 'ORG':
        cur.company = splitStructured(value).filter(Boolean).join(', ') || null
        break
      case 'ADR':
        cur.address = splitStructured(value).filter(Boolean).join(', ') || null
        break
      case 'BDAY':
        cur.birthday = parseBirthday(value)
        break
      case 'NOTE':
        cur.notes = unescapeValue(value).trim() || null
        break
    }
  }
  return cards
}

export function vcardFileName(name: string): string {
  return (name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ') || 'contact') + '.vcf'
}

function vcardFile(card: ContactCard): File {
  return new File([toVCard(card)], vcardFileName(card.full_name), { type: 'text/vcard' })
}

/** Downloads a .vcf. On iPhone this opens the "Create New Contact" preview. */
export function downloadVCard(card: ContactCard) {
  const url = URL.createObjectURL(vcardFile(card))
  const a = document.createElement('a')
  a.href = url
  a.download = vcardFileName(card.full_name)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Opens the phone's share sheet with the contact as a file; falls back to download. */
export async function shareVCard(card: ContactCard) {
  const file = vcardFile(card)
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: card.full_name })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
    }
  } else {
    downloadVCard(card)
  }
}
