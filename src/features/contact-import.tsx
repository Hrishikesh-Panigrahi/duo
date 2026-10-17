import { useMemo, useRef, useState } from 'react'
import { FileUp, Smartphone } from 'lucide-react'
import { useSpace } from '../lib/store'
import { parseVCards, type ContactCard } from '../lib/vcard'
import { isIOS } from '../lib/device'
import { findDuplicate } from '../lib/contact-match'
import { Avatar, Button, Sheet, cx, toast, toastError } from '../components/ui'
import { useBusy } from '../components/use-busy'

// A big import lists only this many, so the sheet stays quick to draw; all of them are still imported.
const PREVIEW_ROWS = 200

export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Import contacts">
      <ImportBody onDone={onClose} />
    </Sheet>
  )
}

function ImportBody({ onDone }: { onDone: () => void }) {
  const [cards, setCards] = useState<ContactCard[] | null>(null)
  if (cards) return <ImportReview cards={cards} onBack={() => setCards(null)} onDone={onDone} />
  return <ImportSource onCards={setCards} />
}

/** The Contact Picker API, where the browser has it (Chrome on Android). */
async function pickFromPhone(): Promise<ContactCard[]> {
  const picked = await navigator.contacts!.select(['name', 'tel', 'email'], { multiple: true })
  const cards: ContactCard[] = []
  for (const person of picked) {
    // The name is the first one the phone gives, else the first number or email; a contact with none is left out.
    const fullName = (person.name?.[0] || person.tel?.[0] || person.email?.[0] || '').trim()
    if (fullName) cards.push({ full_name: fullName, phones: person.tel ?? [], emails: person.email ?? [] })
  }
  return cards
}

function ImportSource({ onCards }: { onCards: (cards: ContactCard[]) => void }) {
  const canPick = typeof navigator.contacts?.select === 'function'
  const pick = () =>
    pickFromPhone().then((found) => {
      if (found.length) onCards(found)
    }, toastError)
  return (
    <div className="space-y-3">
      {canPick && (
        <Button className="w-full" icon={<Smartphone />} onClick={pick}>
          Choose from this phone
        </Button>
      )}
      <VcfFileButton primary={!canPick} onCards={onCards} />
      <ExportHelp />
    </div>
  )
}

function VcfFileButton({ primary, onCards }: { primary: boolean; onCards: (cards: ContactCard[]) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  async function read(file: File) {
    const parsed = parseVCards(await file.text())
    if (!parsed.length) return toast("Couldn't find any contacts in that file", 'error')
    onCards(parsed)
  }
  return (
    <>
      <Button variant={primary ? 'primary' : 'secondary'} className="w-full" icon={<FileUp />} onClick={() => fileInput.current?.click()}>
        Import a .vcf file
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept=".vcf,text/vcard,text/x-vcard"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) read(file).catch(toastError)
        }}
      />
    </>
  )
}

function ExportHelp() {
  if (!isIOS()) {
    return (
      <div className="space-y-2 pt-2 text-sm text-muted">
        <p>Export a .vcf from your Contacts app (or contacts.google.com → Export → vCard) and pick it here.</p>
      </div>
    )
  }
  return (
    <div className="space-y-2 pt-2 text-sm text-muted">
      <p>
        <strong className="text-ink">One contact:</strong> in the Contacts app, open them → Share Contact → Save to Files, then pick that
        file here.
      </p>
      <p>
        <strong className="text-ink">Everyone:</strong> on icloud.com/contacts, select all → ⚙︎ → Export vCard.
      </p>
    </div>
  )
}

function ImportReview({ cards, onBack, onDone }: { cards: ContactCard[]; onBack: () => void; onDone: () => void }) {
  const { contacts, actions } = useSpace()
  const [skipExisting, setSkipExisting] = useState(true)
  const { busy, run } = useBusy({ toast: true })
  const duplicates = useMemo(() => new Set(cards.filter((card) => findDuplicate(card, contacts))), [cards, contacts])
  const toImport = skipExisting ? cards.filter((card) => !duplicates.has(card)) : cards
  async function importAll(chosen: ContactCard[]) {
    const importedCount = await actions.contacts.importCards(chosen)
    toast(`Imported ${importedCount} contact${importedCount === 1 ? '' : 's'}`)
    onDone()
  }
  return (
    <div className="space-y-4">
      <p>
        Found <strong>{cards.length}</strong> contact{cards.length === 1 ? '' : 's'}.
      </p>
      {duplicates.size > 0 && <SkipExisting count={duplicates.size} checked={skipExisting} onChange={setSkipExisting} />}
      <CardList cards={cards} duplicates={duplicates} dimDuplicates={skipExisting} />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" loading={busy} disabled={!toImport.length} onClick={() => run(() => importAll(toImport))}>
          Import {toImport.length}
        </Button>
      </div>
    </div>
  )
}

function SkipExisting({ count, checked, onChange }: { count: number; checked: boolean; onChange: (skip: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 accent-[var(--accent)]" />
      <span className="text-sm">Skip {count} you already have (same name or phone number)</span>
    </label>
  )
}

type CardListProps = { cards: ContactCard[]; duplicates: Set<ContactCard>; dimDuplicates: boolean }

function CardList({ cards, duplicates, dimDuplicates }: CardListProps) {
  return (
    <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
      {cards.slice(0, PREVIEW_ROWS).map((card, i) => (
        <li key={i} className={cx('flex items-center gap-3 px-3 py-2', dimDuplicates && duplicates.has(card) && 'opacity-40')}>
          <Avatar name={card.full_name} size={32} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{card.full_name}</div>
            <div className="truncate text-xs text-muted">{card.phones[0] ?? card.emails[0] ?? ''}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}
