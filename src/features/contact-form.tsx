import { useMemo, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { Contact, ContactInput } from '../lib/types'
import { NO_YEAR, parseYMD, toYMDString } from '../lib/dates'
import { Button, Field, IconButton, Input, Sheet, Textarea } from '../components/ui'
import { useBusy } from '../components/use-busy'
import { findExisting } from './contacts'

const monthNames = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2000, i, 1)))
const select = 'h-11 rounded-xl bg-surface-2 px-3 text-base outline-none focus:ring-2 focus:ring-accent/40'

type BirthdayParts = { d: string; m: string; y: string }

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

function birthdayParts(b: string | null): BirthdayParts {
  if (!b) return { d: '', m: '', y: '' }
  const { y, m, d } = parseYMD(b)
  return { d: String(d), m: String(m), y: y === NO_YEAR ? '' : String(y) }
}

/** Returns YYYY-MM-DD, null for "no birthday", or an error message. */
function birthdayValue({ d, m, y }: BirthdayParts): { value: string | null } | { error: string } {
  if (!d && !m && !y) return { value: null }
  if (!d || !m) return { error: 'Pick both a day and a month for the birthday, or clear it.' }
  const year = y ? Number(y) : NO_YEAR
  if (y && (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear())) return { error: 'That birth year looks off.' }
  // 2000 is a leap year, so Feb 29 is allowed when the year is unknown.
  const daysInMonth = new Date(year === NO_YEAR ? 2000 : year, Number(m), 0).getDate()
  if (Number(d) > daysInMonth) return { error: `${monthNames[Number(m) - 1]} doesn't have ${d} days.` }
  return { value: toYMDString({ y: year, m: Number(m), d: Number(d) }) }
}

function draftFrom(c: Contact | null): ContactDraft {
  return {
    name: c?.full_name ?? '',
    phones: c?.phones.length ? c.phones : [''],
    emails: c?.emails.length ? c.emails : [''],
    company: c?.company ?? '',
    birthday: birthdayParts(c?.birthday ?? null),
    address: c?.address ?? '',
    notes: c?.notes ?? '',
    tags: c?.tags ?? [],
    favorite: c?.favorite ?? false,
  }
}

/** The contact to save, or why it can't be saved yet. */
function inputFrom(d: ContactDraft): ContactInput | { error: string } {
  const birthday = birthdayValue(d.birthday)
  if ('error' in birthday) return birthday
  return {
    full_name: d.name.trim(),
    phones: d.phones.map((x) => x.trim()).filter(Boolean),
    emails: d.emails.map((x) => x.trim()).filter(Boolean),
    company: d.company.trim() || null,
    address: d.address.trim() || null,
    birthday: birthday.value,
    notes: d.notes.trim() || null,
    tags: d.tags,
    favorite: d.favorite,
  }
}

type FormSheetProps = { contact: Contact | null; open: boolean; onClose: () => void; onSaved: (c: Contact) => void }

export function ContactFormSheet({ contact, open, onClose, onSaved }: FormSheetProps) {
  const done = (c: Contact) => {
    onClose()
    onSaved(c)
  }
  return (
    <Sheet open={open} onClose={onClose} title={contact ? 'Edit contact' : 'New contact'}>
      <ContactForm initial={contact} onDone={done} />
    </Sheet>
  )
}

function ContactForm({ initial, onDone }: { initial: Contact | null; onDone: (c: Contact) => void }) {
  const { actions } = useSpace()
  const [draft, setDraft] = useState(() => draftFrom(initial))
  const set = (patch: Partial<ContactDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const { busy, error, setError, run } = useBusy()
  function submit(e: FormEvent) {
    e.preventDefault()
    const input = inputFrom(draft)
    if ('error' in input) return setError(input.error)
    void run(async () => onDone(initial ? await actions.contacts.update(initial.id, input) : await actions.contacts.add(input)))
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
  const duplicate = isNew && draft.name.trim() ? findExisting(typed, contacts) : undefined
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

function BirthdayInput({ value: b, onChange }: { value: BirthdayParts; onChange: (b: BirthdayParts) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-muted">Birthday</span>
      <div className="grid grid-cols-[5rem_1fr_6rem] gap-2">
        <select aria-label="Birthday day" className={select} value={b.d} onChange={(e) => onChange({ ...b, d: e.target.value })}>
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
        <select aria-label="Birthday month" className={select} value={b.m} onChange={(e) => onChange({ ...b, m: e.target.value })}>
          <option value="">Month</option>
          {monthNames.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
        <Input
          aria-label="Birth year (optional)"
          inputMode="numeric"
          placeholder="Year"
          maxLength={4}
          value={b.y}
          onChange={(e) => onChange({ ...b, y: e.target.value.replace(/\D/g, '') })}
        />
      </div>
      <span className="mt-1.5 block text-xs text-muted">Year is optional. Birthdays show up under Lists → Coming up.</span>
    </div>
  )
}

type MultiInputProps = { label: string; type: 'tel' | 'email'; addLabel: string; values: string[]; onChange: (v: string[]) => void }

/** Several phone numbers or emails, one field each. */
function MultiInput({ label, type, addLabel, values, onChange }: MultiInputProps) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      <div className="space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex gap-1">
            <Input
              type={type}
              inputMode={type}
              autoComplete="off"
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

type TagInputProps = { tags: string[]; onChange: (t: string[]) => void; suggestions: string[] }

function TagInput({ tags, onChange, suggestions }: TagInputProps) {
  const add = (raw: string) => {
    const t = raw.trim().toLowerCase()
    if (t && !tags.includes(t)) onChange([...tags, t])
  }
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-muted">Tags</span>
      <ChosenTags tags={tags} onRemove={(t) => onChange(tags.filter((x) => x !== t))} />
      <NewTagInput onAdd={add} />
      <SuggestedTags tags={suggestions.filter((s) => !tags.includes(s)).slice(0, 8)} onAdd={add} />
    </div>
  )
}

/** Adds a tag on comma, Enter, or leaving the field. */
function NewTagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const [draft, setDraft] = useState('')
  const add = (tag: string) => {
    onAdd(tag)
    setDraft('')
  }
  return (
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
        if (e.key !== 'Enter') return
        e.preventDefault()
        add(draft)
      }}
      onBlur={() => draft && add(draft)}
    />
  )
}

function ChosenTags({ tags, onRemove }: { tags: string[]; onRemove: (tag: string) => void }) {
  if (!tags.length) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onRemove(t)}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-ink pr-2 pl-3 text-sm text-bg"
          aria-label={`Remove tag ${t}`}
        >
          {t} <X className="size-3.5" />
        </button>
      ))}
    </div>
  )
}

function SuggestedTags({ tags, onAdd }: { tags: string[]; onAdd: (tag: string) => void }) {
  if (!tags.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {tags.map((s) => (
        <button key={s} type="button" onClick={() => onAdd(s)} className="h-7 rounded-full bg-surface-2 px-2.5 text-xs text-muted">
          + {s}
        </button>
      ))}
    </div>
  )
}
