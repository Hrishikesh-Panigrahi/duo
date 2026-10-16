import { useEffect, useMemo, useState } from 'react'
import { BookUser, Import, Plus, Search, Star } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { Contact } from '../lib/types'
import { filterContacts } from '../lib/contact-match'
import { Avatar, Button, Chip, EmptyState, IconButton, Input } from '../components/ui'
import { ContactDetailSheet } from './contact-detail'
import { ContactFormSheet } from './contact-form'
import { ImportSheet } from './contact-import'
import { useNav } from './nav'

export function ContactRow({ contact, onClick }: { contact: Contact; onClick: () => void }) {
  // A non-breaking space keeps the row's height when there's nothing to show under the name.
  const subtitle = contact.company || contact.phones[0] || contact.emails[0] || '\u00A0'
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2">
      <Avatar name={contact.full_name} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{contact.full_name}</div>
        <div className="truncate text-sm text-muted">{subtitle}</div>
      </div>
      {contact.tags.slice(0, 2).map((tagName) => (
        <span key={tagName} className="hidden rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted min-[400px]:inline">
          {tagName}
        </span>
      ))}
    </button>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  )
}

/** Searchable list for choosing a contact (used by chat). */
export function ContactPicker({ onPick }: { onPick: (contact: Contact) => void }) {
  const { contacts } = useSpace()
  const [query, setQuery] = useState('')
  const results = filterContacts(contacts, query)
  if (!contacts.length) return <p className="py-6 text-center text-sm text-muted">No contacts yet. Add some in the Contacts tab.</p>
  return (
    <div>
      <div className="sticky top-0 z-10 flex bg-surface pb-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search" />
      </div>
      <div className="-mx-5">
        {results.map((contact) => (
          <ContactRow key={contact.id} contact={contact} onClick={() => onPick(contact)} />
        ))}
      </div>
    </div>
  )
}

type Section = { title: string | null; rows: Contact[] }
// The title that marks the favourites section; ContactSection draws its heading.
const FAVOURITES_SECTION = '★ Favourites'

/** Tags, most used first. */
function tagsByUse(contacts: Contact[]): string[] {
  const useCount = new Map<string, number>()
  for (const contact of contacts) {
    for (const tag of contact.tags) useCount.set(tag, (useCount.get(tag) ?? 0) + 1)
  }
  // Most used first; ties alphabetically.
  const sorted = [...useCount].sort(([tagA, countA], [tagB, countB]) => countB - countA || tagA.localeCompare(tagB))
  return sorted.map(([tag]) => tag)
}

/**
 * Favourites first, then everyone else under their first letter.
 * Contacts arrive sorted by name (src/lib/space/view.ts), so each letter's contacts are already together.
 */
function groupByFirstLetter(contacts: Contact[]): Section[] {
  const sections: Section[] = []
  const favourites = contacts.filter((c) => c.favorite)
  if (favourites.length) sections.push({ title: FAVOURITES_SECTION, rows: favourites })
  let current: Section | undefined
  for (const contact of contacts) {
    if (contact.favorite) continue
    // Spread splits by code point, so a first character made of two UTF-16 units (an emoji, say) stays whole.
    const firstChar = [...contact.full_name.trim()][0]?.toUpperCase() ?? '#'
    const letter = /\p{L}/u.test(firstChar) ? firstChar : '#'
    if (!current || current.title !== letter) {
      current = { title: letter, rows: [] }
      sections.push(current)
    }
    current.rows.push(contact)
  }
  return sections
}

export function ContactsTab() {
  const { contacts } = useSpace()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const sheets = useContactSheets()
  const results = filterContacts(contacts, query, tag)
  // Searching or picking a tag shows one plain list of matches, without letter headings.
  const isFiltering = query.trim() !== '' || Boolean(tag)
  const sections = isFiltering ? [{ title: null, rows: results }] : groupByFirstLetter(results)
  const add = () => sheets.setEditing('new')
  const startImport = () => sheets.setImporting(true)
  return (
    <div className="flex h-full flex-col">
      <ContactsToolbar query={query} onQuery={setQuery} selectedTag={tag} onSelectTag={setTag} onAdd={add} onImport={startImport} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {contacts.length === 0 && <ContactsEmpty onAdd={add} onImport={startImport} />}
        {contacts.length > 0 && results.length === 0 && <p className="py-12 text-center text-sm text-muted">No one matches that.</p>}
        {results.length > 0 && sections.map((section, i) => <ContactSection key={section.title ?? i} section={section} onOpen={sheets.setOpenId} />)}
      </div>
      <ContactsSheets sheets={sheets} />
    </div>
  )
}

type ToolbarProps = {
  query: string
  onQuery: (query: string) => void
  selectedTag: string | null
  onSelectTag: (tag: string | null) => void
  onAdd: () => void
  onImport: () => void
}

function ContactsToolbar({ query, onQuery, selectedTag, onSelectTag, onAdd, onImport }: ToolbarProps) {
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
          {tags.map((tagName) => (
            <Chip key={tagName} active={selectedTag === tagName} onClick={() => onSelectTag(selectedTag === tagName ? null : tagName)}>
              {tagName}
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

function ContactSection({ section, onOpen }: { section: Section; onOpen: (id: string) => void }) {
  const favouritesHeading = (
    <span className="inline-flex items-center gap-1">
      <Star className="size-3 fill-current" /> Favourites
    </span>
  )
  return (
    <section>
      {section.title && (
        <h3 className="sticky top-0 z-10 bg-bg px-4 py-1 text-xs font-semibold text-muted">
          {section.title === FAVOURITES_SECTION ? favouritesHeading : section.title}
        </h3>
      )}
      {section.rows.map((contact) => (
        <ContactRow key={contact.id} contact={contact} onClick={() => onOpen(contact.id)} />
      ))}
    </section>
  )
}

type ContactSheetState = ReturnType<typeof useContactSheets>

/** Which contact is open, being edited, or imported. Chat and Lists can ask for one to be opened. */
function useContactSheets() {
  const { contacts } = useSpace()
  const nav = useNav()
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Contact | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    if (!nav.contactIdToOpen) return
    setOpenId(nav.contactIdToOpen)
    nav.clearContactIdToOpen()
  }, [nav])
  const shownContact = contacts.find((c) => c.id === openId) ?? null
  return { shownContact, setOpenId, editing, setEditing, importing, setImporting }
}

function ContactsSheets({ sheets }: { sheets: ContactSheetState }) {
  const editShownContact = () => {
    sheets.setEditing(sheets.shownContact)
    sheets.setOpenId(null)
  }
  return (
    <>
      <ContactDetailSheet contact={sheets.shownContact} onClose={() => sheets.setOpenId(null)} onEdit={editShownContact} />
      <ContactFormSheet
        contact={sheets.editing === 'new' ? null : sheets.editing}
        open={sheets.editing !== null}
        onClose={() => sheets.setEditing(null)}
        onSaved={(saved) => sheets.setOpenId(saved.id)}
      />
      <ImportSheet open={sheets.importing} onClose={() => sheets.setImporting(false)} />
    </>
  )
}
