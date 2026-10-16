// What each decrypted record must look like before the screens use it. Only someone with the passphrase
// can write a record, but a malformed one still mustn't be able to break the other phone's app.
type Check = (v: unknown) => boolean

const text: Check = (v) => typeof v === 'string'
const maybeText: Check = (v) => v === null || v === undefined || typeof v === 'string'
const texts: Check = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
const flag: Check = (v) => typeof v === 'boolean'
const maybeDay: Check = (v) => v === null || v === undefined || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
const maybeCount: Check = (v) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0)

const card = { full_name: text, phones: texts, emails: texts, company: maybeText, address: maybeText, birthday: maybeDay, notes: maybeText }
const media = { kind: (v: unknown) => v === 'image' || v === 'video', mime: text, size: maybeCount, width: maybeCount, height: maybeCount }

/** True if `value` is an object whose every listed field passes its check. */
function fits(value: unknown, shape: Record<string, Check>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(shape).every(([field, check]) => check((value as Record<string, unknown>)[field]))
}

export const shapes = {
  contact: (v: unknown) => fits(v, { ...card, tags: texts, favorite: flag }),
  note: (v: unknown) => fits(v, { title: text, body: text, pinned: flag }),
  list: (v: unknown) => fits(v, { title: text, emoji: maybeText }),
  item: (v: unknown) => fits(v, { text: text, done: flag, due_date: maybeDay }),
  name: text,
  message: (v: unknown) => {
    if (!fits(v, { body: maybeText })) return false
    const { contact, media: m } = v as { contact: unknown; media?: unknown }
    return (contact === null || fits(contact, card)) && (m == null || fits(m, media))
  },
}
