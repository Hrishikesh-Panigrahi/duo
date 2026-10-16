import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Cake, Download, Mail, MapPin, MessageSquare, Pencil, Phone, QrCode, Send, Share2, Smartphone, Star, StickyNote, Tag, Trash } from 'lucide-react'
import { useAuthorName, useSpace } from '../lib/store'
import { toCard, type Contact } from '../lib/types'
import { downloadVCard, shareVCard, toVCard, type ContactCard } from '../lib/vcard'
import { formatDay, nextBirthday, relativeDays, todayYMD } from '../lib/dates'
import { Avatar, Button, IconButton, Sheet, cx, toast, toastError } from '../components/ui'
import { useBusy } from '../components/use-busy'

const dial = (p: string) => p.replace(/[^\d+]/g, '')

/** wa.me needs a full international number; only offer WhatsApp when we have one. */
function whatsappNumber(p: string): string | null {
  const d = dial(p)
  if (d.startsWith('+')) return d.slice(1)
  if (d.startsWith('00')) return d.slice(2)
  return null
}

type DetailSheetProps = { contact: Contact | null; onClose: () => void; onEdit: () => void }

export function ContactDetailSheet({ contact, onClose, onEdit }: DetailSheetProps) {
  const buttons = contact && (
    <>
      <FavouriteButton contact={contact} />
      <IconButton label="Edit" onClick={onEdit}>
        <Pencil />
      </IconButton>
    </>
  )
  return (
    <Sheet open={!!contact} onClose={onClose} actions={buttons}>
      {contact && <ContactDetail contact={contact} onClose={onClose} />}
    </Sheet>
  )
}

function FavouriteButton({ contact }: { contact: Contact }) {
  const { actions } = useSpace()
  return (
    <IconButton
      label={contact.favorite ? 'Remove from favourites' : 'Add to favourites'}
      onClick={() => actions.contacts.update(contact.id, { favorite: !contact.favorite }).catch(toastError)}
      className={contact.favorite ? 'text-amber-500' : 'text-muted'}
    >
      <Star className={contact.favorite ? 'fill-current' : ''} />
    </IconButton>
  )
}

function ContactDetail({ contact: c, onClose }: { contact: Contact; onClose: () => void }) {
  const authorName = useAuthorName()
  const [showQr, setShowQr] = useState(false)
  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <Avatar name={c.full_name} size={76} />
        <h2 className="mt-3 text-2xl font-bold tracking-tight">{c.full_name}</h2>
        {c.company && <p className="text-muted">{c.company}</p>}
      </div>
      <QuickActions contact={c} />
      <ContactInfo contact={c} />
      <p className="mt-2 text-center text-xs text-muted">Added by {authorName(c.created_by)}</p>
      {showQr && <QrBlock card={toCard(c)} />}
      <ContactButtons contact={c} showQr={showQr} onToggleQr={() => setShowQr((s) => !s)} onDeleted={onClose} />
    </div>
  )
}

function QuickActions({ contact: c }: { contact: Contact }) {
  const phone = c.phones[0]
  const wa = phone ? whatsappNumber(phone) : null
  return (
    <div className="mt-5 grid grid-cols-4 gap-2">
      <QuickAction href={phone ? `tel:${dial(phone)}` : null} icon={<Phone />} label="Call" />
      <QuickAction href={phone ? `sms:${dial(phone)}` : null} icon={<MessageSquare />} label="Text" />
      <QuickAction href={wa ? `https://wa.me/${wa}` : null} icon={<Smartphone />} label="WhatsApp" />
      <QuickAction href={c.emails[0] ? `mailto:${c.emails[0]}` : null} icon={<Mail />} label="Email" />
    </div>
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

function ContactInfo({ contact: c }: { contact: Contact }) {
  const mapUrl = c.address && `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`
  return (
    <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl bg-surface-2/60">
      <PhonesAndEmails contact={c} />
      {c.birthday && <BirthdayRow birthday={c.birthday} />}
      {mapUrl && (
        <InfoRow icon={<MapPin />} label="Address">
          <a href={mapUrl} target="_blank" rel="noreferrer" className="whitespace-pre-line text-accent">
            {c.address}
          </a>
        </InfoRow>
      )}
      {c.notes && (
        <InfoRow icon={<StickyNote />} label="Notes">
          <span className="whitespace-pre-line">{c.notes}</span>
        </InfoRow>
      )}
      {c.tags.length > 0 && <InfoRow icon={<Tag />} label="Tags">{c.tags.join(', ')}</InfoRow>}
    </div>
  )
}

function PhonesAndEmails({ contact: c }: { contact: Contact }) {
  return (
    <>
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
    </>
  )
}

function BirthdayRow({ birthday }: { birthday: string }) {
  const next = nextBirthday(birthday, todayYMD())
  return (
    <InfoRow icon={<Cake />} label="Birthday">
      {formatDay(birthday)}
      <span className="text-muted">
        {' · '}
        {next.turning !== null ? `turns ${next.turning} ` : ''}
        {relativeDays(next.daysAway).toLowerCase()}
      </span>
    </InfoRow>
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

type ContactButtonsProps = { contact: Contact; showQr: boolean; onToggleQr: () => void; onDeleted: () => void }

function ContactButtons({ contact: c, showQr, onToggleQr, onDeleted }: ContactButtonsProps) {
  const { actions, partner } = useSpace()
  const sending = useBusy({ toast: true })
  const card = toCard(c)
  async function send() {
    await actions.chat.send({ contact: card })
    toast(`Sent to ${partner?.display_name ?? 'chat'}`)
  }
  return (
    <div className="mt-5 space-y-2">
      <Button className="w-full" icon={<Send />} loading={sending.busy} disabled={!partner} onClick={() => sending.run(send, { settle: true })}>
        Send to {partner?.display_name ?? 'your person'}
      </Button>
      <ShareButtons card={card} showQr={showQr} onToggleQr={onToggleQr} />
      <DeleteContactButton contact={c} onDeleted={onDeleted} />
    </div>
  )
}

function DeleteContactButton({ contact: c, onDeleted }: { contact: Contact; onDeleted: () => void }) {
  const { actions } = useSpace()
  async function remove() {
    if (!confirm(`Delete ${c.full_name} for both of you?`)) return
    try {
      await actions.contacts.remove(c.id)
      onDeleted()
      toast('Contact deleted')
    } catch (e) {
      toastError(e)
    }
  }
  return (
    <Button variant="danger" size="sm" className="w-full" icon={<Trash />} onClick={remove}>
      Delete contact
    </Button>
  )
}

function ShareButtons({ card, showQr, onToggleQr }: { card: ContactCard; showQr: boolean; onToggleQr: () => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button variant="secondary" size="sm" icon={<Download />} onClick={() => downloadVCard(card)}>
        Save
      </Button>
      <Button variant="secondary" size="sm" icon={<Share2 />} onClick={() => shareVCard(card).catch(toastError)}>
        Share
      </Button>
      <Button variant="secondary" size="sm" icon={<QrCode />} onClick={onToggleQr}>
        {showQr ? 'Hide QR' : 'QR'}
      </Button>
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
