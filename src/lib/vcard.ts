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
  const utf8 = new TextEncoder()
  let folded = ''
  let currentLine = ''
  let lineBytes = 0
  let maxBytes = 75
  for (const character of line) {
    const characterBytes = utf8.encode(character).length
    if (lineBytes + characterBytes > maxBytes) {
      folded += currentLine + '\r\n '
      currentLine = ''
      lineBytes = 0
      maxBytes = 74 // continuation lines spend one octet on the leading space
    }
    currentLine += character
    lineBytes += characterBytes
  }
  return folded + currentLine
}

export function toVCard(card: ContactCard, opts: { includeNotes?: boolean } = {}): string {
  const name = card.full_name.trim()
  const words = name.split(/\s+/)
  const family = words.length > 1 ? words[words.length - 1] : ''
  const given = words.length > 1 ? words.slice(0, -1).join(' ') : name

  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeValue(family)};${escapeValue(given)};;;`, `FN:${escapeValue(name)}`]
  if (card.company?.trim()) lines.push(`ORG:${escapeValue(card.company.trim())}`)
  for (const phone of card.phones) if (phone.trim()) lines.push(`TEL;TYPE=CELL:${escapeValue(phone.trim())}`)
  for (const email of card.emails) if (email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${escapeValue(email.trim())}`)
  if (card.birthday) {
    lines.push(
      card.birthday.startsWith(`${NO_YEAR}-`) ? `BDAY;X-APPLE-OMIT-YEAR=${NO_YEAR}:${card.birthday}` : `BDAY:${card.birthday}`,
    )
  }
  if (card.address?.trim()) lines.push(`ADR;TYPE=HOME:;;${escapeValue(card.address.trim())};;;;`)
  if (card.notes?.trim() && opts.includeNotes !== false) lines.push(`NOTE:${escapeValue(card.notes.trim())}`)
  lines.push('END:VCARD')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** Splits a structured value (N, ADR, ORG) on unescaped semicolons. */
function splitStructured(value: string): string[] {
  const parts: string[] = []
  let part = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      part += value[i] + value[i + 1]
      i++
    } else if (value[i] === ';') {
      parts.push(unescapeValue(part).trim())
      part = ''
    } else {
      part += value[i]
    }
  }
  parts.push(unescapeValue(part).trim())
  return parts
}

function decodeQuotedPrintable(encoded: string): string {
  const bytes: number[] = []
  const utf8 = new TextEncoder()
  for (let i = 0; i < encoded.length; i++) {
    const hex = encoded.slice(i + 1, i + 3)
    if (encoded[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16))
      i += 2
    } else {
      bytes.push(...utf8.encode(encoded[i]))
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

const FULL_DATE = /^(\d{4})-?(\d{2})-?(\d{2})/
/** vCard 4's "no year" form: --MMDD or --MM-DD. */
const NO_YEAR_DATE = /^--(\d{2})-?(\d{2})/

function parseBirthday(raw: string): string | null {
  const value = raw.trim()
  const full = FULL_DATE.exec(value)
  if (full) return `${full[1]}-${full[2]}-${full[3]}`
  const monthDay = NO_YEAR_DATE.exec(value)
  if (monthDay) return `${NO_YEAR}-${monthDay[1]}-${monthDay[2]}`
  return null
}

/** A card while it's being read. Its full_name is worked out from FN, N and the rest once the card ends. */
type Draft = { formattedName?: string; structuredName?: string } & Omit<ContactCard, 'full_name'>

const BYTE_ORDER_MARK = /^\uFEFF/
const LINE_ENDINGS = /\r\n?/g
/** A line break followed by a space or tab continues the line before it. */
const FOLDED_LINE_BREAK = /\n[ \t]/g

/** Parses every card in a .vcf file. Handles vCard 2.1 (Android exports), 3.0 and 4.0. */
export function parseVCards(text: string): ContactCard[] {
  const unfolded = text.replace(BYTE_ORDER_MARK, '').replace(LINE_ENDINGS, '\n').replace(FOLDED_LINE_BREAK, '')
  const lines = unfolded.split('\n')
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
      while (value.endsWith('=') && i + 1 < lines.length) {
        i++
        value = value.slice(0, -1) + lines[i]
      }
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

function readProperty(draft: Draft, prop: string, value: string) {
  if (prop === 'FN') draft.formattedName = unescapeValue(value)
  else if (prop === 'N') draft.structuredName = value
  else if (prop === 'TEL') draft.phones.push(unescapeValue(value).replace(/^tel:/i, '').trim())
  else if (prop === 'EMAIL') draft.emails.push(unescapeValue(value).replace(/^mailto:/i, '').trim())
  else if (prop === 'ORG') draft.company = splitStructured(value).filter(Boolean).join(', ') || null
  else if (prop === 'ADR') draft.address = splitStructured(value).filter(Boolean).join(', ') || null
  else if (prop === 'BDAY') draft.birthday = parseBirthday(value)
  else if (prop === 'NOTE') draft.notes = unescapeValue(value).trim() || null
}

function finishCard(draft: Draft): ContactCard | null {
  const phones = draft.phones.filter(Boolean)
  const emails = draft.emails.filter(Boolean)
  // N is family;given;additional;prefix;suffix
  const [family, given, additional, prefix, suffix] = draft.structuredName ? splitStructured(draft.structuredName) : []
  const nameFromParts = [prefix, given, additional, family, suffix].filter(Boolean).join(' ')
  const full_name = (draft.formattedName?.trim() || nameFromParts || draft.company || phones[0] || emails[0] || '').trim()
  if (!full_name) return null
  const { company = null, address = null, birthday = null, notes = null } = draft
  return { full_name, phones, emails, company, address, birthday, notes }
}

export function vcardFileName(name: string): string {
  return (name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ') || 'contact') + '.vcf'
}

/** Downloads a .vcf. On iPhone this opens the "Create New Contact" preview. */
export function downloadVCard(card: ContactCard) {
  const url = URL.createObjectURL(new File([toVCard(card)], vcardFileName(card.full_name), { type: 'text/vcard' }))
  const link = document.createElement('a')
  link.href = url
  link.download = vcardFileName(card.full_name)
  document.body.appendChild(link)
  link.click()
  link.remove()
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
