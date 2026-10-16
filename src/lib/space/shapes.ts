// What each decrypted record must look like before the screens use it. Only someone with the passphrase
// can write a record, but a malformed one still mustn't be able to break the other phone's app.
type Check = (v: unknown) => boolean

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/

const isString: Check = (v) => typeof v === 'string'
const isOptionalString: Check = (v) => v === null || v === undefined || typeof v === 'string'
const isStringList: Check = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isBoolean: Check = (v) => typeof v === 'boolean'
const isOptionalDate: Check = (v) => v === null || v === undefined || (typeof v === 'string' && YYYY_MM_DD.test(v))
const isOptionalCount: Check = (v) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0)

const cardShape = {
  full_name: isString,
  phones: isStringList,
  emails: isStringList,
  company: isOptionalString,
  address: isOptionalString,
  birthday: isOptionalDate,
  notes: isOptionalString,
}
const mediaShape = {
  kind: (v: unknown) => v === 'image' || v === 'video',
  mime: isString,
  size: isOptionalCount,
  width: isOptionalCount,
  height: isOptionalCount,
}

/** True if `value` is an object whose every listed field passes its check. */
function matchesShape(value: unknown, shape: Record<string, Check>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(shape).every(([field, check]) => check((value as Record<string, unknown>)[field]))
}

export const shapes = {
  contact: (v: unknown) => matchesShape(v, { ...cardShape, tags: isStringList, favorite: isBoolean }),
  note: (v: unknown) => matchesShape(v, { title: isString, body: isString, pinned: isBoolean }),
  list: (v: unknown) => matchesShape(v, { title: isString, emoji: isOptionalString }),
  item: (v: unknown) => matchesShape(v, { text: isString, done: isBoolean, due_date: isOptionalDate }),
  name: isString,
  message: (v: unknown) => {
    if (!matchesShape(v, { body: isOptionalString })) return false
    // `contact` is always there (null for none); `media` may be missing as well as null.
    const { contact, media } = v as { contact: unknown; media?: unknown }
    const contactOk = contact === null || matchesShape(contact, cardShape)
    const mediaOk = media == null || matchesShape(media, mediaShape)
    return contactOk && mediaOk
  },
}
