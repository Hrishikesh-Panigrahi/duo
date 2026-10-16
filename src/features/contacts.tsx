import { useEffect, useMemo, useState } from 'react'
import { BookUser, Import, Plus, Search, Star } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { Contact } from '../lib/types'
import type { ContactCard } from '../lib/vcard'
import { Avatar, Button, Chip, EmptyState, IconButton, Input } from '../components/ui'
import { ContactDetailSheet } from './contact-detail'
import { ContactFormSheet } from './contact-form'
import { ImportSheet } from './contact-import'
import { useNav } from './nav'

/** A contact already in the book with the same name or a shared phone number (its last ten digits). */
export function findExisting(card: ContactCard, contacts: Contact[]): Contact | undefined {
  const name = card.full_name.trim().toLowerCase()
  const phones = new Set(card.phones.map((p) => p.replace(/\D/g, '').slice(-10)).filter((k) => k.length >= 7))
  return contacts.find(
    (c) => c.full_name.trim().toLowerCase() === name || c.phones.some((p) => phones.has(p.replace(/\D/g, '').slice(-10))),
  )
}

export function filterContacts(contacts: Contact[], query: string, tag: string | null = null): Contact[] {
  const needle = query.trim().toLowerCase()
  const digits = needle.replace(/\D/g, '')
  return contacts.filter((c) => {
    if (tag && !c.tags.includes(tag)) return false
    if (!needle) return true
    const hay = [c.full_name, c.company, c.notes, c.address, ...c.emails, ...c.tags].filter(Boolean).join('\n').toLowerCase()
    return hay.includes(needle) || (digits.length >= 3 && c.phones.some((p) => p.replace(/\D/g, '').includes(digits)))
  })
}

export function ContactRow({ contact: c, onClick }: { contact: Contact; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2">
      <Avatar name={c.full_name} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{c.full_name}</div>
        <div className="truncate text-sm text-muted">{c.company || c.phones[0] || c.emails[0] || ' '}</div>
      </div>
      {c.tags.slice(0, 2).map((t) => (
        <span key={t} className="hidden rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted min-[400px]:inline">
          {t}
        </span>
      ))}
    </button>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  )
}

/** Searchable list for choosing a contact (used by chat). */
export function ContactPicker({ onPick }: { onPick: (c: Contact) => void }) {
  const { contacts } = useSpace()
  const [q, setQ] = useState('')
  const results = filterContacts(contacts, q)
  if (!contacts.length) return <p className="py-6 text-center text-sm text-muted">No contacts yet. Add some in the Contacts tab.</p>
  return (
    <div>
      <div className="sticky top-0 z-10 flex bg-surface pb-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search" />
      </div>
      <div className="-mx-5">
        {results.map((c) => (
          <ContactRow key={c.id} contact={c} onClick={() => onPick(c)} />
        ))}
      </div>
    </div>
  )
}

type Section = { title: string | null; rows: Contact[] }
const FAVOURITES = '★ Favourites'

/** Tags, most used first. */
function tagsByUse(contacts: Contact[]): string[] {
  const counts = new Map<string, number>()
  contacts.forEach((c) => c.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)))
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
}

/** Favourites first, then everyone else under their first letter. */
function alphabetical(contacts: Contact[]): Section[] {
  const out: Section[] = []
  const favourites = contacts.filter((c) => c.favorite)
  if (favourites.length) out.push({ title: FAVOURITES, rows: favourites })
  for (const c of contacts) {
    if (c.favorite) continue
    const first = [...c.full_name.trim()][0]?.toUpperCase() ?? '#'
    const letter = /\p{L}/u.test(first) ? first : '#'
    if (out.at(-1)?.title !== letter) out.push({ title: letter, rows: [] })
    out.at(-1)!.rows.push(c)
  }
  return out
}

export function ContactsTab() {
  const { contacts } = useSpace()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const sheets = useContactSheets()
  const results = filterContacts(contacts, query, tag)
  const sections = query.trim() || tag ? [{ title: null, rows: results }] : alphabetical(results)
  const add = () => sheets.setEditing('new')
  const startImport = () => sheets.setImporting(true)
  return (
    <div className="flex h-full flex-col">
      <ContactsToolbar query={query} onQuery={setQuery} tag={tag} onTag={setTag} onAdd={add} onImport={startImport} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {contacts.length === 0 && <ContactsEmpty onAdd={add} onImport={startImport} />}
        {contacts.length > 0 && results.length === 0 && <p className="py-12 text-center text-sm text-muted">No one matches that.</p>}
        {results.length > 0 && sections.map((s, i) => <ContactSection key={s.title ?? i} section={s} onOpen={sheets.setOpenId} />)}
      </div>
      <ContactsSheets sheets={sheets} />
    </div>
  )
}

type ToolbarProps = {
  query: string
  onQuery: (query: string) => void
  tag: string | null
  onTag: (tag: string | null) => void
  onAdd: () => void
  onImport: () => void
}

function ContactsToolbar({ query, onQuery, tag, onTag, onAdd, onImport }: ToolbarProps) {
  const { contacts } = useSpace()
  const tags = useMemo(() => tagsByUse(contacts), [contacts])
  return (
    <div className="shrink-0 space-y-3 px-4 pt-3 pb-2">
      <div className="flex gap-2">
        <SearchBox value={query} onChange={onQuery} placeholder={contacts.length ? `Search ${contacts.length} contacts` : 'Search'} />
        <IconButton label="Import contacts" onClick={onImport} className="size-11 bg-surface-2">
          <Import />
        </IconButton>
        <IconButton label="Add contact" onClick={onAdd} className="size-11 bg-accent text-accent-ink hover:bg-accent">
          <Plus />
        </IconButton>
      </div>
      {tags.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {tags.map((t) => (
            <Chip key={t} active={tag === t} onClick={() => onTag(tag === t ? null : t)}>
              {t}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

function ContactsEmpty({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <EmptyState icon={<BookUser />} title="One contact book, for both of you">
      <p>The plumber, the in-laws, the vet. Add someone once and you'll both have them.</p>
      <div className="mt-5 flex justify-center gap-2">
        <Button size="sm" icon={<Plus />} onClick={onAdd}>
          Add contact
        </Button>
        <Button size="sm" variant="secondary" icon={<Import />} onClick={onImport}>
          Import
        </Button>
      </div>
    </EmptyState>
  )
}

function ContactSection({ section: s, onOpen }: { section: Section; onOpen: (id: string) => void }) {
  const favourites = (
    <span className="inline-flex items-center gap-1">
      <Star className="size-3 fill-current" /> Favourites
    </span>
  )
  return (
    <section>
      {s.title && (
        <h3 className="sticky top-0 z-10 bg-bg px-4 py-1 text-xs font-semibold text-muted">{s.title === FAVOURITES ? favourites : s.title}</h3>
      )}
      {s.rows.map((c) => (
        <ContactRow key={c.id} contact={c} onClick={() => onOpen(c.id)} />
      ))}
    </section>
  )
}

type ContactSheets = ReturnType<typeof useContactSheets>

/** Which contact is open, being edited, or imported. Chat and Lists can ask for one to be opened. */
function useContactSheets() {
  const { contacts } = useSpace()
  const nav = useNav()
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Contact | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    if (!nav.focusContactId) return
    setOpenId(nav.focusContactId)
    nav.clearFocusContact()
  }, [nav])
  const open = contacts.find((c) => c.id === openId) ?? null
  return { open, setOpenId, editing, setEditing, importing, setImporting }
}

function ContactsSheets({ sheets: s }: { sheets: ContactSheets }) {
  const edit = () => {
    s.setEditing(s.open)
    s.setOpenId(null)
  }
  return (
    <>
      <ContactDetailSheet contact={s.open} onClose={() => s.setOpenId(null)} onEdit={edit} />
      <ContactFormSheet
        contact={s.editing === 'new' ? null : s.editing}
        open={s.editing !== null}
        onClose={() => s.setEditing(null)}
        onSaved={(c) => s.setOpenId(c.id)}
      />
      <ImportSheet open={s.importing} onClose={() => s.setImporting(false)} />
    </>
  )
}
