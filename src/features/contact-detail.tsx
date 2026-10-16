import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Cake, Download, Mail, MapPin, MessageSquare, Pencil, Phone, QrCode, Send, Share2, Smartphone, Star, StickyNote, Tag, Trash } from 'lucide-react'
import { useAuthorName, useSpace } from '../lib/store'
import { toCard, type Contact } from '../lib/types'
import { downloadVCard, shareVCard, toVCard, type ContactCard } from '../lib/vcard'
import { formatDay, nextBirthday, relativeDays, toLocalYMD } from '../lib/dates'
import { Avatar, Button, IconButton, Sheet, cx, toast, toastError } from '../components/ui'
import { useBusy } from '../components/use-busy'

const dialable = (phone: string) => phone.replace(/[^\d+]/g, '')

/** wa.me needs a full international number; only offer WhatsApp when we have one. */
function whatsappNumber(phone: string): string | null {
  const digits = dialable(phone)
  if (digits.startsWith('+')) return digits.slice(1)
  if (digits.startsWith('00')) return digits.slice(2)
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

function ContactDetail({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const authorName = useAuthorName()
  const [showQr, setShowQr] = useState(false)
  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <Avatar name={contact.full_name} size={76} />
        <h2 className="mt-3 text-2xl font-bold tracking-tight">{contact.full_name}</h2>
        {contact.company && <p className="text-muted">{contact.company}</p>}
      </div>
      <QuickActions contact={contact} />
      <ContactInfo contact={contact} />
      <p className="mt-2 text-center text-xs text-muted">Added by {authorName(contact.created_by)}</p>
      {showQr && <QrBlock card={toCard(contact)} />}
      <ContactButtons contact={contact} showQr={showQr} onToggleQr={() => setShowQr((s) => !s)} onDeleted={onClose} />
    </div>
  )
}

function QuickActions({ contact }: { contact: Contact }) {
  const phone = contact.phones[0]
  const whatsapp = phone ? whatsappNumber(phone) : null
  return (
    <div className="mt-5 grid grid-cols-4 gap-2">
      <QuickAction href={phone ? `tel:${dialable(phone)}` : null} icon={<Phone />} label="Call" />
      <QuickAction href={phone ? `sms:${dialable(phone)}` : null} icon={<MessageSquare />} label="Text" />
      <QuickAction href={whatsapp ? `https://wa.me/${whatsapp}` : null} icon={<Smartphone />} label="WhatsApp" />
      <QuickAction href={contact.emails[0] ? `mailto:${contact.emails[0]}` : null} icon={<Mail />} label="Email" />
    </div>
  )
}

function QuickAction({ href, icon, label }: { href: string | null; icon: ReactNode; label: string }) {
  const quickActionClass = 'flex flex-col items-center gap-1 rounded-xl bg-surface-2 py-2.5 text-xs font-medium [&_svg]:size-5'
  if (!href) {
    return (
      <span className={cx(quickActionClass, 'opacity-35')} aria-disabled>
        {icon}
        {label}
      </span>
    )
  }
  return (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={cx(quickActionClass, 'text-accent hover:brightness-95')}>
      {icon}
      {label}
    </a>
  )
}

function ContactInfo({ contact }: { contact: Contact }) {
  const mapUrl = contact.address && `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.address)}`
  return (
    <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl bg-surface-2/60">
      <PhonesAndEmails contact={contact} />
      {contact.birthday && <BirthdayRow birthday={contact.birthday} />}
      {mapUrl && (
        <InfoRow icon={<MapPin />} label="Address">
          <a href={mapUrl} target="_blank" rel="noreferrer" className="whitespace-pre-line text-accent">
            {contact.address}
          </a>
        </InfoRow>
      )}
      {contact.notes && (
        <InfoRow icon={<StickyNote />} label="Notes">
          <span className="whitespace-pre-line">{contact.notes}</span>
        </InfoRow>
      )}
      {contact.tags.length > 0 && <InfoRow icon={<Tag />} label="Tags">{contact.tags.join(', ')}</InfoRow>}
    </div>
  )
}

function PhonesAndEmails({ contact }: { contact: Contact }) {
  return (
    <>
      {contact.phones.map((phone, i) => (
        <InfoRow key={`p${i}`} icon={<Phone />} label={contact.phones.length > 1 ? `Phone ${i + 1}` : 'Phone'}>
          <a href={`tel:${dialable(phone)}`} className="text-accent">
            {phone}
          </a>
        </InfoRow>
      ))}
      {contact.emails.map((email, i) => (
        <InfoRow key={`e${i}`} icon={<Mail />} label="Email">
          <a href={`mailto:${email}`} className="text-accent">
            {email}
          </a>
        </InfoRow>
      ))}
    </>
  )
}

function BirthdayRow({ birthday }: { birthday: string }) {
  const next = nextBirthday(birthday, toLocalYMD())
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

function ContactButtons({ contact, showQr, onToggleQr, onDeleted }: ContactButtonsProps) {
  const { actions, partner } = useSpace()
  const sending = useBusy({ toast: true })
  const card = toCard(contact)
  async function send() {
    await actions.chat.send({ contact: card })
    toast(`Sent to ${partner?.display_name ?? 'chat'}`)
  }
  return (
    <div className="mt-5 space-y-2">
      <Button className="w-full" icon={<Send />} loading={sending.busy} disabled={!partner} onClick={() => sending.run(send, { idleAfterSuccess: true })}>
        Send to {partner?.display_name ?? 'your person'}
      </Button>
      <ShareButtons card={card} showQr={showQr} onToggleQr={onToggleQr} />
      <DeleteContactButton contact={contact} onDeleted={onDeleted} />
    </div>
  )
}

function DeleteContactButton({ contact, onDeleted }: { contact: Contact; onDeleted: () => void }) {
  const { actions } = useSpace()
  async function remove() {
    if (!confirm(`Delete ${contact.full_name} for both of you?`)) return
    try {
      await actions.contacts.remove(contact.id)
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
