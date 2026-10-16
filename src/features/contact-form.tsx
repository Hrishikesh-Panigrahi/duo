import { useMemo, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { Contact, ContactInput } from '../lib/types'
import { NO_YEAR, parseYMD, toYMDString } from '../lib/dates'
import { findDuplicate } from '../lib/contact-match'
import { Button, Field, IconButton, Input, Sheet, Textarea } from '../components/ui'
import { useBusy } from '../components/use-busy'

const monthNames = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2000, i, 1)))
const selectClass = 'h-11 rounded-xl bg-surface-2 px-3 text-base outline-none focus:ring-2 focus:ring-accent/40'

type BirthdayParts = { day: string; month: string; year: string }

type ContactDraft = {
  name: string
  phones: string[]
  emails: string[]
  company: string
  birthday: BirthdayParts
  address: string
  notes: string
  tags: string[]
  favorite: boolean
}

type DraftProps = { draft: ContactDraft; set: (patch: Partial<ContactDraft>) => void }

function birthdayParts(birthday: string | null): BirthdayParts {
  if (!birthday) return { day: '', month: '', year: '' }
  const { y, m, d } = parseYMD(birthday)
  return { day: String(d), month: String(m), year: y === NO_YEAR ? '' : String(y) }
}

/** Returns YYYY-MM-DD, null for "no birthday", or an error message. */
function birthdayValue(parts: BirthdayParts): { value: string | null } | { error: string } {
  if (!parts.day && !parts.month && !parts.year) return { value: null }
  if (!parts.day || !parts.month) return { error: 'Pick both a day and a month for the birthday, or clear it.' }
  const day = Number(parts.day), month = Number(parts.month)
  const year = parts.year ? Number(parts.year) : NO_YEAR
  const yearLooksOff = parts.year !== '' && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear())
  if (yearLooksOff) return { error: 'That birth year looks off.' }
  // Date counts months from 0, so `month` (1–12) names the next month, and its day 0 is the last day of this one.
  // 2000 is a leap year, so Feb 29 is allowed when the year is unknown.
  const daysInMonth = new Date(year === NO_YEAR ? 2000 : year, month, 0).getDate()
  if (day > daysInMonth) return { error: `${monthNames[month - 1]} doesn't have ${parts.day} days.` }
  return { value: toYMDString({ y: year, m: month, d: day }) }
}

function draftFrom(contact: Contact | null): ContactDraft {
  return {
    name: contact?.full_name ?? '',
    phones: contact?.phones.length ? contact.phones : [''],
    emails: contact?.emails.length ? contact.emails : [''],
    company: contact?.company ?? '',
    birthday: birthdayParts(contact?.birthday ?? null),
    address: contact?.address ?? '',
    notes: contact?.notes ?? '',
    tags: contact?.tags ?? [],
    favorite: contact?.favorite ?? false,
  }
}

/** The contact to save, or why it can't be saved yet. */
function contactToSave(draft: ContactDraft): ContactInput | { error: string } {
  const birthday = birthdayValue(draft.birthday)
  if ('error' in birthday) return birthday
  return {
    full_name: draft.name.trim(),
    phones: draft.phones.map((phone) => phone.trim()).filter(Boolean),
    emails: draft.emails.map((email) => email.trim()).filter(Boolean),
    company: draft.company.trim() || null,
    address: draft.address.trim() || null,
    birthday: birthday.value,
    notes: draft.notes.trim() || null,
    tags: draft.tags,
    favorite: draft.favorite,
  }
}

type FormSheetProps = { contact: Contact | null; open: boolean; onClose: () => void; onSaved: (saved: Contact) => void }

export function ContactFormSheet({ contact, open, onClose, onSaved }: FormSheetProps) {
  const done = (saved: Contact) => {
    onClose()
    onSaved(saved)
  }
  return (
    <Sheet open={open} onClose={onClose} title={contact ? 'Edit contact' : 'New contact'}>
      <ContactForm initial={contact} onDone={done} />
    </Sheet>
  )
}

function ContactForm({ initial, onDone }: { initial: Contact | null; onDone: (saved: Contact) => void }) {
  const { actions } = useSpace()
  const [draft, setDraft] = useState(() => draftFrom(initial))
  const set = (patch: Partial<ContactDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const { busy, error, setError, run } = useBusy()
  function submit(e: FormEvent) {
    e.preventDefault()
    const toSave = contactToSave(draft)
    if ('error' in toSave) {
      setError(toSave.error)
      return
    }
    void run(async () => {
      const saved = initial ? await actions.contacts.update(initial.id, toSave) : await actions.contacts.add(toSave)
      onDone(saved)
    })
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <NameAndNumbers draft={draft} set={set} isNew={!initial} />
      <MoreAboutThem draft={draft} set={set} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" loading={busy} className="w-full">
        {initial ? 'Save changes' : 'Add contact'}
      </Button>
    </form>
  )
}

function NameAndNumbers({ draft, set, isNew }: DraftProps & { isNew: boolean }) {
  const { contacts } = useSpace()
  const typed = { full_name: draft.name, phones: draft.phones, emails: draft.emails }
  const duplicate = isNew && draft.name.trim() ? findDuplicate(typed, contacts) : undefined
  return (
    <>
      <Field label="Name">
        <Input required autoFocus={isNew} maxLength={200} autoComplete="off" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      {duplicate && (
        <p className="-mt-3 text-sm text-muted">
          Heads up: <span className="font-medium text-ink">{duplicate.full_name}</span> is already in your contacts.
        </p>
      )}
      <MultiInput label="Phone" type="tel" addLabel="Add another number" values={draft.phones} onChange={(phones) => set({ phones })} />
      <MultiInput label="Email" type="email" addLabel="Add another email" values={draft.emails} onChange={(emails) => set({ emails })} />
      <Field label="Company or role">
        <Input value={draft.company} onChange={(e) => set({ company: e.target.value })} placeholder="e.g. Plumber, Dr. Mehta's clinic" />
      </Field>
    </>
  )
}

function MoreAboutThem({ draft, set }: DraftProps) {
  const { contacts } = useSpace()
  const allTags = useMemo(() => [...new Set(contacts.flatMap((c) => c.tags))].sort(), [contacts])
  return (
    <>
      <BirthdayInput value={draft.birthday} onChange={(birthday) => set({ birthday })} />
      <Field label="Address">
        <Textarea rows={2} value={draft.address} onChange={(e) => set({ address: e.target.value })} />
      </Field>
      <Field label="Notes" hint="Gate code, kids' names, how you know them…">
        <Textarea rows={3} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      <TagInput tags={draft.tags} onChange={(tags) => set({ tags })} suggestions={allTags} />
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={draft.favorite} onChange={(e) => set({ favorite: e.target.checked })} className="size-5 accent-[var(--accent)]" />
        <span>Favourite</span>
      </label>
    </>
  )
}

function BirthdayInput({ value, onChange }: { value: BirthdayParts; onChange: (parts: BirthdayParts) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-muted">Birthday</span>
      <div className="grid grid-cols-[5rem_1fr_6rem] gap-2">
        <select aria-label="Birthday day" className={selectClass} value={value.day} onChange={(e) => onChange({ ...value, day: e.target.value })}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
        <select aria-label="Birthday month" className={selectClass} value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value })}>
          <option value="">Month</option>
          {monthNames.map((monthName, i) => <option key={monthName} value={i + 1}>{monthName}</option>)}
        </select>
        <Input
          aria-label="Birth year (optional)"
          inputMode="numeric"
          placeholder="Year"
          maxLength={4}
          value={value.year}
          onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, '') })}
        />
      </div>
      <span className="mt-1.5 block text-xs text-muted">Year is optional. Birthdays show up under Lists → Coming up.</span>
    </div>
  )
}

type MultiInputProps = { label: string; type: 'tel' | 'email'; addLabel: string; values: string[]; onChange: (values: string[]) => void }

/** Several phone numbers or emails, one field each. */
function MultiInput({ label, type, addLabel, values, onChange }: MultiInputProps) {
  const replaceAt = (index: number, next: string) => onChange(values.map((value, i) => (i === index ? next : value)))
  const removeAt = (index: number) => onChange(values.filter((_, i) => i !== index))
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      <div className="space-y-2">
        {values.map((value, i) => (
          <MultiInputRow
            key={i}
            label={label}
            type={type}
            index={i}
            value={value}
            canRemove={values.length > 1}
            onChange={(next) => replaceAt(i, next)}
            onRemove={() => removeAt(i)}
          />
        ))}
      </div>
      <button type="button" className="mt-2 text-sm font-medium text-accent" onClick={() => onChange([...values, ''])}>
        + {addLabel}
      </button>
    </div>
  )
}

type MultiInputRowProps = {
  label: string
  type: 'tel' | 'email'
  index: number
  value: string
  canRemove: boolean
  onChange: (next: string) => void
  onRemove: () => void
}

function MultiInputRow({ label, type, index, value, canRemove, onChange, onRemove }: MultiInputRowProps) {
  return (
    <div className="flex gap-1">
      <Input type={type} inputMode={type} autoComplete="off" aria-label={`${label} ${index + 1}`} value={value} onChange={(e) => onChange(e.target.value)} />
      {canRemove && (
        <IconButton label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={onRemove} className="size-11 text-muted">
          <X />
        </IconButton>
      )}
    </div>
  )
}

type TagInputProps = { tags: string[]; onChange: (tags: string[]) => void; suggestions: string[] }

function TagInput({ tags, onChange, suggestions }: TagInputProps) {
  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase()
    if (tag && !tags.includes(tag)) onChange([...tags, tag])
  }
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-muted">Tags</span>
      <ChosenTags tags={tags} onRemove={(removed) => onChange(tags.filter((tag) => tag !== removed))} />
      <NewTagInput onAdd={add} />
      <SuggestedTags tags={suggestions.filter((s) => !tags.includes(s)).slice(0, 8)} onAdd={add} />
    </div>
  )
}

/** Adds a tag on comma, Enter, or leaving the field. */
function NewTagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const [typedTag, setTypedTag] = useState('')
  const add = (tag: string) => {
    onAdd(tag)
    setTypedTag('')
  }
  return (
    <Input
      value={typedTag}
      placeholder="family, work, doctor…"
      aria-label="Add a tag"
      onChange={(e) => {
        const typed = e.target.value
        if (typed.endsWith(',')) add(typed.slice(0, -1))
        else setTypedTag(typed)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        add(typedTag)
      }}
      onBlur={() => {
        if (typedTag) add(typedTag)
      }}
    />
  )
}

function ChosenTags({ tags, onRemove }: { tags: string[]; onRemove: (tag: string) => void }) {
  if (!tags.length) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => onRemove(tag)}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-ink pr-2 pl-3 text-sm text-bg"
          aria-label={`Remove tag ${tag}`}
        >
          {tag} <X className="size-3.5" />
        </button>
      ))}
    </div>
  )
}

function SuggestedTags({ tags, onAdd }: { tags: string[]; onAdd: (tag: string) => void }) {
  if (!tags.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <button key={tag} type="button" onClick={() => onAdd(tag)} className="h-7 rounded-full bg-surface-2 px-2.5 text-xs text-muted">
          + {tag}
        </button>
      ))}
    </div>
  )
}
