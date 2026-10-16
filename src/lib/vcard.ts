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
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n') // unfolded
  const cards: ContactCard[] = []
  let draft: Draft | null = null
  for (let i = 0; i < lines.length; i++) {
    const colon = lines[i].indexOf(':')
    if (colon < 0) continue
    const [rawName, ...params] = lines[i].slice(0, colon).split(';')
    const prop = rawName.split('.').pop()!.toUpperCase() // drop group prefixes like "item1."
    let value = lines[i].slice(colon + 1)
    if (params.some((p) => /^(ENCODING=)?QUOTED-PRINTABLE$/i.test(p))) {
      // vCard 2.1 soft line breaks: a trailing "=" continues onto the next line.
      while (value.endsWith('=') && i + 1 < lines.length) value = value.slice(0, -1) + lines[++i]
      value = decodeQuotedPrintable(value)
    }
    if (prop === 'BEGIN' && value.trim().toUpperCase() === 'VCARD') draft = { phones: [], emails: [] }
    else if (draft && prop === 'END') {
      const card = finishCard(draft)
      if (card) cards.push(card)
      draft = null
    } else if (draft) readProperty(draft, prop, value)
  }
  return cards
}

function readProperty(d: Draft, prop: string, value: string) {
  if (prop === 'FN') d.fn = unescapeValue(value)
  else if (prop === 'N') d.n = value
  else if (prop === 'TEL') d.phones.push(unescapeValue(value).replace(/^tel:/i, '').trim())
  else if (prop === 'EMAIL') d.emails.push(unescapeValue(value).replace(/^mailto:/i, '').trim())
  else if (prop === 'ORG') d.company = splitStructured(value).filter(Boolean).join(', ') || null
  else if (prop === 'ADR') d.address = splitStructured(value).filter(Boolean).join(', ') || null
  else if (prop === 'BDAY') d.birthday = parseBirthday(value)
  else if (prop === 'NOTE') d.notes = unescapeValue(value).trim() || null
}

function finishCard(d: Draft): ContactCard | null {
  const phones = d.phones.filter(Boolean)
  const emails = d.emails.filter(Boolean)
  const n = d.n ? splitStructured(d.n) : []
  // N is family;given;additional;prefix;suffix
  const fromN = [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' ')
  const full_name = (d.fn?.trim() || fromN || d.company || phones[0] || emails[0] || '').trim()
  if (!full_name) return null
  const { company = null, address = null, birthday = null, notes = null } = d
  return { full_name, phones, emails, company, address, birthday, notes }
}

export function vcardFileName(name: string): string {
  return (name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ') || 'contact') + '.vcf'
}

/** Downloads a .vcf. On iPhone this opens the "Create New Contact" preview. */
export function downloadVCard(card: ContactCard) {
  const url = URL.createObjectURL(new File([toVCard(card)], vcardFileName(card.full_name), { type: 'text/vcard' }))
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
  const file = new File([toVCard(card)], vcardFileName(card.full_name), { type: 'text/vcard' })
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
