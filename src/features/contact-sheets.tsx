import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import QRCode from 'qrcode'
import {
  Cake,
  Download,
  FileUp,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  QrCode,
  Send,
  Share2,
  Smartphone,
  Star,
  StickyNote,
  Tag,
  Trash,
  X,
} from 'lucide-react'
import { useAuthorName, useSpace } from '../lib/store'
import { toCard, type Contact, type ContactInput } from '../lib/types'
import { downloadVCard, parseVCards, shareVCard, toVCard, type ContactCard } from '../lib/vcard'
import { NO_YEAR, formatDay, nextBirthday, parseYMD, relativeDays, todayYMD, toYMDString } from '../lib/dates'
import { isIOS } from '../lib/device'
import { Avatar, Button, Field, IconButton, Input, Sheet, Textarea, cx, errorMessage, toast, toastError } from '../components/ui'
import { findExisting } from './contacts'

const dial = (p: string) => p.replace(/[^\d+]/g, '')

/** wa.me needs a full international number; only offer WhatsApp when we have one. */
function whatsappNumber(p: string): string | null {
  const d = dial(p)
  if (d.startsWith('+')) return d.slice(1)
  if (d.startsWith('00')) return d.slice(2)
  return null
}

// ─── Detail ────────────────────────────────────────────────────────────

export function ContactDetailSheet({
  contact,
  onClose,
  onEdit,
}: {
  contact: Contact | null
  onClose: () => void
  onEdit: () => void
}) {
  const { actions } = useSpace()
  return (
    <Sheet
      open={!!contact}
      onClose={onClose}
      actions={
        contact && (
          <>
            <IconButton
              label={contact.favorite ? 'Remove from favourites' : 'Add to favourites'}
              onClick={() => actions.updateContact(contact.id, { favorite: !contact.favorite }).catch(toastError)}
              className={contact.favorite ? 'text-amber-500' : 'text-muted'}
            >
              <Star className={contact.favorite ? 'fill-current' : ''} />
            </IconButton>
            <IconButton label="Edit" onClick={onEdit}>
              <Pencil />
            </IconButton>
          </>
        )
      }
    >
      {contact && <ContactDetail contact={contact} onClose={onClose} />}
    </Sheet>
  )
}

function QuickAction({ href, icon, label }: { href: string | null; icon: ReactNode; label: string }) {
  const cls = 'flex flex-col items-center gap-1 rounded-xl bg-surface-2 py-2.5 text-xs font-medium [&_svg]:size-5'
  if (!href) {
    return (
      <span className={cx(cls, 'opacity-35')} aria-disabled>
        {icon}
        {label}
      </span>
    )
  }
  return (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={cx(cls, 'text-accent hover:brightness-95')}>
      {icon}
      {label}
    </a>
  )
}

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 text-muted [&_svg]:size-[18px]" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted">{label}</div>
        <div className="break-words">{children}</div>
      </div>
    </div>
  )
}

function ContactDetail({ contact: c, onClose }: { contact: Contact; onClose: () => void }) {
  const { actions, partner } = useSpace()
  const authorName = useAuthorName()
  const [showQr, setShowQr] = useState(false)
  const [sending, setSending] = useState(false)
  const card = toCard(c)
  const phone = c.phones[0]
  const wa = phone ? whatsappNumber(phone) : null
  const bday = c.birthday ? nextBirthday(c.birthday, todayYMD()) : null

  async function sendToPartner() {
    setSending(true)
    try {
      await actions.sendMessage({ contact: card })
      toast(`Sent to ${partner?.display_name ?? 'chat'}`)
    } catch (e) {
      toastError(e)
    } finally {
      setSending(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete ${c.full_name} for both of you?`)) return
    try {
      await actions.deleteContact(c.id)
      onClose()
      toast('Contact deleted')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <Avatar name={c.full_name} size={76} />
        <h2 className="mt-3 text-2xl font-bold tracking-tight">{c.full_name}</h2>
        {c.company && <p className="text-muted">{c.company}</p>}
      </div>

      <div className="mt-5 grid grid-cols-4 gap-2">
        <QuickAction href={phone ? `tel:${dial(phone)}` : null} icon={<Phone />} label="Call" />
        <QuickAction href={phone ? `sms:${dial(phone)}` : null} icon={<MessageSquare />} label="Text" />
        <QuickAction href={wa ? `https://wa.me/${wa}` : null} icon={<Smartphone />} label="WhatsApp" />
        <QuickAction href={c.emails[0] ? `mailto:${c.emails[0]}` : null} icon={<Mail />} label="Email" />
      </div>

      <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl bg-surface-2/60">
        {c.phones.map((p, i) => (
          <InfoRow key={`p${i}`} icon={<Phone />} label={c.phones.length > 1 ? `Phone ${i + 1}` : 'Phone'}>
            <a href={`tel:${dial(p)}`} className="text-accent">
              {p}
            </a>
          </InfoRow>
        ))}
        {c.emails.map((e, i) => (
          <InfoRow key={`e${i}`} icon={<Mail />} label="Email">
            <a href={`mailto:${e}`} className="text-accent">
              {e}
            </a>
          </InfoRow>
        ))}
        {c.birthday && bday && (
          <InfoRow icon={<Cake />} label="Birthday">
            {formatDay(c.birthday)}
            <span className="text-muted">
              {' · '}
              {bday.turning !== null ? `turns ${bday.turning} ` : ''}
              {relativeDays(bday.daysAway).toLowerCase()}
            </span>
          </InfoRow>
        )}
        {c.address && (
          <InfoRow icon={<MapPin />} label="Address">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`}
              target="_blank"
              rel="noreferrer"
              className="whitespace-pre-line text-accent"
            >
              {c.address}
            </a>
          </InfoRow>
        )}
        {c.notes && (
          <InfoRow icon={<StickyNote />} label="Notes">
            <span className="whitespace-pre-line">{c.notes}</span>
          </InfoRow>
        )}
        {c.tags.length > 0 && (
          <InfoRow icon={<Tag />} label="Tags">
            {c.tags.join(', ')}
          </InfoRow>
        )}
      </div>
      <p className="mt-2 text-center text-xs text-muted">Added by {authorName(c.created_by)}</p>

      {showQr && <QrBlock card={card} />}

      <div className="mt-5 space-y-2">
        <Button className="w-full" icon={<Send />} loading={sending} disabled={!partner} onClick={sendToPartner}>
          Send to {partner?.display_name ?? 'your person'}
        </Button>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" size="sm" icon={<Download />} onClick={() => downloadVCard(card)}>
            Save
          </Button>
          <Button variant="secondary" size="sm" icon={<Share2 />} onClick={() => shareVCard(card).catch(toastError)}>
            Share
          </Button>
          <Button variant="secondary" size="sm" icon={<QrCode />} onClick={() => setShowQr((s) => !s)}>
            {showQr ? 'Hide QR' : 'QR'}
          </Button>
        </div>
        <Button variant="danger" size="sm" className="w-full" icon={<Trash />} onClick={remove}>
          Delete contact
        </Button>
      </div>
    </div>
  )
}

function QrBlock({ card }: { card: ContactCard }) {
  // Notes are left out: they're private, and they'd make the code dense and hard to scan.
  const text = toVCard(card, { includeNotes: false })
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 640, errorCorrectionLevel: 'M' }).then(setSrc, toastError)
  }, [text])
  return (
    <div className="mt-4 rounded-2xl bg-white p-4 text-center">
      {src && <img src={src} alt={`QR code for ${card.full_name}`} className="mx-auto aspect-square w-full max-w-64" />}
      <p className="mt-2 text-sm text-stone-600">Point any phone's camera at this to save {card.full_name}.</p>
    </div>
  )
}

// ─── Add / edit ────────────────────────────────────────────────────────

export function ContactFormSheet({
  contact,
  open,
  onClose,
  onSaved,
}: {
  contact: Contact | null
  open: boolean
  onClose: () => void
  onSaved: (c: Contact) => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title={contact ? 'Edit contact' : 'New contact'}>
      <ContactForm
        initial={contact}
        onDone={(c) => {
          onClose()
          onSaved(c)
        }}
      />
    </Sheet>
  )
}

const monthNames = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2000, i, 1)),
)

function birthdayParts(b: string | null) {
  if (!b) return { d: '', m: '', y: '' }
  const { y, m, d } = parseYMD(b)
  return { d: String(d), m: String(m), y: y === NO_YEAR ? '' : String(y) }
}

/** Returns YYYY-MM-DD, null for "no birthday", or an error message. */
function birthdayValue({ d, m, y }: { d: string; m: string; y: string }): { value: string | null } | { error: string } {
  if (!d && !m && !y) return { value: null }
  if (!d || !m) return { error: 'Pick both a day and a month for the birthday, or clear it.' }
  const year = y ? Number(y) : NO_YEAR
  if (y && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear())) {
    return { error: 'That birth year looks off.' }
  }
  // 2000 is a leap year, so Feb 29 is allowed when the year is unknown.
  const daysInMonth = new Date(year === NO_YEAR ? 2000 : year, Number(m), 0).getDate()
  if (Number(d) > daysInMonth) return { error: `${monthNames[Number(m) - 1]} doesn't have ${d} days.` }
  return { value: toYMDString({ y: year, m: Number(m), d: Number(d) }) }
}

function MultiInput({
  label,
  values,
  onChange,
  type,
  addLabel,
  autoComplete,
}: {
  label: string
  values: string[]
  onChange: (v: string[]) => void
  type: 'tel' | 'email'
  addLabel: string
  autoComplete: string
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex gap-1">
            <Input
              type={type}
              inputMode={type === 'tel' ? 'tel' : 'email'}
              autoComplete={autoComplete}
              aria-label={`${label} ${i + 1}`}
              value={v}
              onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
            />
            {values.length > 1 && (
              <IconButton label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(values.filter((_, j) => j !== i))} className="size-11 text-muted">
                <X />
              </IconButton>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="mt-2 text-sm font-medium text-accent" onClick={() => onChange([...values, ''])}>
        + {addLabel}
      </button>
    </div>
  )
}

function TagInput({ tags, onChange, suggestions }: { tags: string[]; onChange: (t: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState('')
  const add = (raw: string) => {
    const t = raw.trim().toLowerCase()
    if (t && !tags.includes(t)) onChange([...tags, t])
    setDraft('')
  }
  const unused = suggestions.filter((s) => !tags.includes(s)).slice(0, 8)
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-muted">Tags</span>
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-ink pr-2 pl-3 text-sm text-bg"
              aria-label={`Remove tag ${t}`}
            >
              {t} <X className="size-3.5" />
            </button>
          ))}
        </div>
      )}
      <Input
        value={draft}
        placeholder="family, work, doctor…"
        aria-label="Add a tag"
        onChange={(e) => {
          const v = e.target.value
          if (v.endsWith(',')) add(v.slice(0, -1))
          else setDraft(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          }
        }}
        onBlur={() => draft && add(draft)}
      />
      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unused.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="h-7 rounded-full bg-surface-2 px-2.5 text-xs text-muted">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ContactForm({ initial, onDone }: { initial: Contact | null; onDone: (c: Contact) => void }) {
  const { contacts, actions } = useSpace()
  const [name, setName] = useState(initial?.full_name ?? '')
  const [phones, setPhones] = useState(initial?.phones.length ? initial.phones : [''])
  const [emails, setEmails] = useState(initial?.emails.length ? initial.emails : [''])
  const [company, setCompany] = useState(initial?.company ?? '')
  const [bday, setBday] = useState(() => birthdayParts(initial?.birthday ?? null))
  const [address, setAddress] = useState(initial?.address ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [tags, setTags] = useState(initial?.tags ?? [])
  const [favorite, setFavorite] = useState(initial?.favorite ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allTags = useMemo(() => [...new Set(contacts.flatMap((c) => c.tags))].sort(), [contacts])
  const duplicate = !initial && name.trim() ? findExisting({ full_name: name, phones, emails }, contacts) : undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    const birthday = birthdayValue(bday)
    if ('error' in birthday) return setError(birthday.error)
    const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean)
    const input: ContactInput = {
      full_name: name.trim(),
      phones: clean(phones),
      emails: clean(emails),
      company: company.trim() || null,
      address: address.trim() || null,
      birthday: birthday.value,
      notes: notes.trim() || null,
      tags,
      favorite,
    }
    setBusy(true)
    setError(null)
    try {
      onDone(initial ? await actions.updateContact(initial.id, input) : await actions.addContact(input))
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const select = 'h-11 rounded-xl bg-surface-2 px-3 text-base outline-none focus:ring-2 focus:ring-accent/40'

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Name">
        <Input required autoFocus={!initial} maxLength={200} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {duplicate && (
        <p className="-mt-3 text-sm text-muted">
          Heads up: <span className="font-medium text-ink">{duplicate.full_name}</span> is already in your contacts.
        </p>
      )}
      <MultiInput label="Phone" values={phones} onChange={setPhones} type="tel" addLabel="Add another number" autoComplete="off" />
      <MultiInput label="Email" values={emails} onChange={setEmails} type="email" addLabel="Add another email" autoComplete="off" />
      <Field label="Company or role">
        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Plumber, Dr. Mehta's clinic" />
      </Field>
      <div>
        <span className="mb-1.5 block text-sm font-medium text-muted">Birthday</span>
        <div className="grid grid-cols-[5rem_1fr_6rem] gap-2">
          <select aria-label="Birthday day" className={select} value={bday.d} onChange={(e) => setBday({ ...bday, d: e.target.value })}>
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
          <select aria-label="Birthday month" className={select} value={bday.m} onChange={(e) => setBday({ ...bday, m: e.target.value })}>
            <option value="">Month</option>
            {monthNames.map((n, i) => (
              <option key={n} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
          <Input
            aria-label="Birth year (optional)"
            inputMode="numeric"
            placeholder="Year"
            maxLength={4}
            value={bday.y}
            onChange={(e) => setBday({ ...bday, y: e.target.value.replace(/\D/g, '') })}
          />
        </div>
        <span className="mt-1.5 block text-xs text-muted">Year is optional. Birthdays show up under Lists → Coming up.</span>
      </div>
      <Field label="Address">
        <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <Field label="Notes" hint="Gate code, kids' names, how you know them…">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <TagInput tags={tags} onChange={setTags} suggestions={allTags} />
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} className="size-5 accent-[var(--accent)]" />
        <span>Favourite</span>
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" loading={busy} className="w-full">
        {initial ? 'Save changes' : 'Add contact'}
      </Button>
    </form>
  )
}

// ─── Import ────────────────────────────────────────────────────────────

export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Import contacts">
      <ImportBody onDone={onClose} />
    </Sheet>
  )
}

function ImportBody({ onDone }: { onDone: () => void }) {
  const { contacts, actions } = useSpace()
  const [cards, setCards] = useState<ContactCard[] | null>(null)
  const [skipExisting, setSkipExisting] = useState(true)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const canPick = typeof navigator.contacts?.select === 'function'

  async function pickFromPhone() {
    try {
      const picked = await navigator.contacts!.select(['name', 'tel', 'email'], { multiple: true })
      const found = picked
        .map((p) => ({
          full_name: (p.name?.[0] || p.tel?.[0] || p.email?.[0] || '').trim(),
          phones: p.tel ?? [],
          emails: p.email ?? [],
        }))
        .filter((c) => c.full_name)
      if (found.length) setCards(found)
    } catch (e) {
      toastError(e)
    }
  }

  async function readFile(file: File) {
    const parsed = parseVCards(await file.text())
    if (!parsed.length) return toast("Couldn't find any contacts in that file", 'error')
    setCards(parsed)
  }

  if (cards) {
    const existing = cards.filter((c) => findExisting(c, contacts))
    const toImport = skipExisting ? cards.filter((c) => !findExisting(c, contacts)) : cards
    async function run() {
      setBusy(true)
      try {
        const n = await actions.importContacts(toImport)
        toast(`Imported ${n} contact${n === 1 ? '' : 's'}`)
        onDone()
      } catch (e) {
        toastError(e)
        setBusy(false)
      }
    }
    return (
      <div className="space-y-4">
        <p>
          Found <strong>{cards.length}</strong> contact{cards.length === 1 ? '' : 's'}.
        </p>
        {existing.length > 0 && (
          <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
            <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} className="mt-0.5 size-5 accent-[var(--accent)]" />
            <span className="text-sm">
              Skip {existing.length} you already have (same name or phone number)
            </span>
          </label>
        )}
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {cards.slice(0, 200).map((c, i) => (
            <li key={i} className={cx('flex items-center gap-3 px-3 py-2', skipExisting && findExisting(c, contacts) && 'opacity-40')}>
              <Avatar name={c.full_name} size={32} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c.full_name}</div>
                <div className="truncate text-xs text-muted">{c.phones[0] ?? c.emails[0] ?? ''}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCards(null)}>
            Back
          </Button>
          <Button className="flex-1" loading={busy} disabled={!toImport.length} onClick={run}>
            Import {toImport.length}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {canPick && (
        <Button className="w-full" icon={<Smartphone />} onClick={pickFromPhone}>
          Choose from this phone
        </Button>
      )}
      <Button variant={canPick ? 'secondary' : 'primary'} className="w-full" icon={<FileUp />} onClick={() => fileInput.current?.click()}>
        Import a .vcf file
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept=".vcf,text/vcard,text/x-vcard"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) readFile(f).catch(toastError)
        }}
      />
      <div className="space-y-2 pt-2 text-sm text-muted">
        {isIOS() ? (
          <>
            <p>
              <strong className="text-ink">One contact:</strong> in the Contacts app, open them → Share Contact → Save to Files,
              then pick that file here.
            </p>
            <p>
              <strong className="text-ink">Everyone:</strong> on icloud.com/contacts, select all → ⚙︎ → Export vCard.
            </p>
          </>
        ) : (
          <p>
            Export a .vcf from your Contacts app (or contacts.google.com → Export → vCard) and pick it here.
          </p>
        )}
      </div>
    </div>
  )
}
