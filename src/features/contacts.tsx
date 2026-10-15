import { useEffect, useMemo, useState } from 'react'
import { BookUser, Import, Plus, Search, Star } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { Contact } from '../lib/types'
import type { ContactCard } from '../lib/vcard'
import { Avatar, Button, Chip, EmptyState, IconButton, Input } from '../components/ui'
import { ContactDetailSheet, ContactFormSheet, ImportSheet } from './contact-sheets'
import { useNav } from './nav'

const phoneKey = (p: string) => p.replace(/\D/g, '').slice(-10)

/** A contact already in the book with the same name or a shared phone number. */
export function findExisting(card: ContactCard, contacts: Contact[]): Contact | undefined {
  const name = card.full_name.trim().toLowerCase()
  const phones = new Set(card.phones.map(phoneKey).filter((k) => k.length >= 7))
  return contacts.find(
    (c) => c.full_name.trim().toLowerCase() === name || c.phones.some((p) => phones.has(phoneKey(p))),
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

function groupLetter(name: string) {
  const ch = [...name.trim()][0]?.toUpperCase() ?? '#'
  return /\p{L}/u.test(ch) ? ch : '#'
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

export function ContactsTab() {
  const { contacts } = useSpace()
  const nav = useNav()
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Contact | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  // Chat (and Lists) can ask us to open a contact.
  useEffect(() => {
    if (nav.focusContactId) {
      setOpenId(nav.focusContactId)
      nav.clearFocusContact()
    }
  }, [nav])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    contacts.forEach((c) => c.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)))
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
  }, [contacts])

  const results = filterContacts(contacts, q, tag)
  const filtering = Boolean(q.trim() || tag)

  const sections = useMemo(() => {
    if (filtering) return [{ title: null, rows: results }]
    const out: { title: string | null; rows: Contact[] }[] = []
    const favs = results.filter((c) => c.favorite)
    if (favs.length) out.push({ title: '★ Favourites', rows: favs })
    for (const c of results) {
      if (c.favorite) continue
      const letter = groupLetter(c.full_name)
      if (out.at(-1)?.title !== letter) out.push({ title: letter, rows: [] })
      out.at(-1)!.rows.push(c)
    }
    return out
  }, [results, filtering])

  const open = contacts.find((c) => c.id === openId) ?? null

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 px-4 pt-3 pb-2">
        <div className="flex gap-2">
          <SearchBox value={q} onChange={setQ} placeholder={contacts.length ? `Search ${contacts.length} contacts` : 'Search'} />
          <IconButton label="Import contacts" onClick={() => setImporting(true)} className="size-11 bg-surface-2">
            <Import />
          </IconButton>
          <IconButton label="Add contact" onClick={() => setEditing('new')} className="size-11 bg-accent text-accent-ink hover:bg-accent">
            <Plus />
          </IconButton>
        </div>
        {tags.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
            {tags.map((t) => (
              <Chip key={t} active={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                {t}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {contacts.length === 0 ? (
          <EmptyState icon={<BookUser />} title="One contact book, for both of you">
            <p>The plumber, the in-laws, the vet. Add someone once and you'll both have them.</p>
            <div className="mt-5 flex justify-center gap-2">
              <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>
                Add contact
              </Button>
              <Button size="sm" variant="secondary" icon={<Import />} onClick={() => setImporting(true)}>
                Import
              </Button>
            </div>
          </EmptyState>
        ) : results.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">No one matches that.</p>
        ) : (
          sections.map((s, i) => (
            <section key={s.title ?? i}>
              {s.title && (
                <h3 className="sticky top-0 z-10 bg-bg px-4 py-1 text-xs font-semibold text-muted">
                  {s.title === '★ Favourites' ? (
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3 fill-current" /> Favourites
                    </span>
                  ) : (
                    s.title
                  )}
                </h3>
              )}
              {s.rows.map((c) => (
                <ContactRow key={c.id} contact={c} onClick={() => setOpenId(c.id)} />
              ))}
            </section>
          ))
        )}
      </div>

      <ContactDetailSheet
        contact={open}
        onClose={() => setOpenId(null)}
        onEdit={() => {
          setEditing(open)
          setOpenId(null)
        }}
      />
      <ContactFormSheet
        contact={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(c) => setOpenId(c.id)}
      />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </div>
  )
}
