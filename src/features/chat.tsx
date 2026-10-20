import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject, type UIEvent } from 'react'
import { ArrowUp, ContactRound, Copy, Download, EyeOff, Image, ImagePlus, Lock, MessageCircleHeart, NotebookPen, Plus, Trash } from 'lucide-react'
import { useSpace } from '../lib/store'
import { toCard, type Contact, type Message } from '../lib/types'
import { downloadVCard, type ContactCard } from '../lib/vcard'
import { toLocalYMD } from '../lib/dates'
import { isTouch, useDocumentVisible } from '../lib/device'
import { ChatVisit, messageIdsInView, vanishingToMarkSeen } from '../lib/vanish'
import type { ChatActions } from '../lib/space/chat-actions'
import { Avatar, Button, EmptyState, IconButton, MenuItem, Sheet, cx, toast, toastError } from '../components/ui'
import { useLongPress } from '../components/long-press'
import { useBusy } from '../components/use-busy'
import { findDuplicate } from '../lib/contact-match'
import { ContactPicker } from './contacts'
import { InviteCode } from './space-setup'
import { useNav } from './nav'
import { MediaBubble, MediaSendSheet, MediaViewer } from './chat-media'

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const dayYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
// Messages from the same person within a few minutes sit together.
const GROUP_GAP_MS = 3 * 60_000
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]}!?])/g
// 1–3 emoji and nothing else; each may carry a skin tone or U+FE0F, or be joined by U+200D into one glyph.
const ONE_TO_THREE_EMOJI = /^(?:\p{Extended_Pictographic}(?:\u{FE0F}|[\u{1F3FB}-\u{1F3FF}]|\u{200D}\p{Extended_Pictographic}\u{FE0F}?)*\s*){1,3}$/u
// Out of the chat there's nothing to mark seen (one array, so effects don't rerun for nothing).
const NO_IDS: string[] = []
// The app only counts as left after this long out of view, so picking a photo or glancing away keeps you in the chat.
const AWAY_AFTER_MS = 30_000
// Within this many pixels of the end still counts as being at the bottom.
const NEAR_BOTTOM_PX = 80

type OutgoingMessage = { body?: string; contact?: ContactCard }

function dayLabel(iso: string) {
  const day = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (toLocalYMD(day) === toLocalYMD(now)) return 'Today'
  if (toLocalYMD(day) === toLocalYMD(yesterday)) return 'Yesterday'
  if (day.getFullYear() === now.getFullYear()) return dayFmt.format(day)
  return dayYearFmt.format(day)
}

export function ChatTab({ active }: { active: boolean }) {
  const { actions } = useSpace()
  const scroller = useRef<HTMLDivElement>(null)
  const chat = useChatVisit(active, scroller)
  const scroll = useStickToBottom(scroller, chat.visible, active)
  return (
    <div className="flex h-full flex-col">
      <VanishModeBanner />
      <MessageList messages={chat.visible} scroller={scroller} onScroll={scroll.onScroll} onDeleting={chat.letGo} />
      <Composer
        onSend={(message) => {
          scroll.stickToBottom()
          return actions.chat.send(message)
        }}
        onSendMedia={(file) => {
          scroll.stickToBottom()
          actions.chat.sendMedia(file).catch(toastError)
        }}
        onTyping={() => actions.chat.sendTyping()}
      />
    </div>
  )
}

/** The chat as this visit shows it: in vanish mode, seen messages are gone next time, never while you're here. */
function useChatVisit(active: boolean, scroller: RefObject<HTMLDivElement | null>) {
  const { messages, userId, actions } = useSpace()
  const { inChat, visitNumber } = useInChat(active)
  // A fresh visit each time you come into the chat.
  const visit = useMemo(() => new ChatVisit(), [inChat, visitNumber])
  const visible = useMemo(() => visit.visible(messages), [visit, messages])
  const anyVanishing = messages.some((message) => message.vanishing)
  useClearSeenAsYouComeAndGo(inChat && anyVanishing, visitNumber, actions.chat)
  const candidates = useMemo(() => (inChat ? vanishingToMarkSeen(visible, userId) : NO_IDS), [inChat, visible, userId])
  useMarkSeenWhenInView(candidates, scroller, (ids) => {
    const fresh = visit.takeNewlySeen(ids)
    if (fresh.length > 0) actions.chat.markVanishingSeen(fresh).catch(() => {})
  })
  return { visible, letGo: (id: string) => visit.letGo(id) }
}

/** Whether you're in the chat, and which visit this is. A short trip out of the app doesn't end a visit; a long one does. */
function useInChat(active: boolean) {
  const visible = useDocumentVisible()
  const hiddenAt = useRef<number | null>(null)
  const [away, setAway] = useState(false)
  const [visitNumber, setVisitNumber] = useState(0)
  useEffect(() => {
    if (!visible) {
      hiddenAt.current = Date.now()
      const timer = setTimeout(() => setAway(true), AWAY_AFTER_MS)
      return () => clearTimeout(timer)
    }
    // A phone may freeze a hidden page, so the timer can't be trusted: measure the time away instead.
    if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= AWAY_AFTER_MS) setVisitNumber((n) => n + 1)
    hiddenAt.current = null
    setAway(false)
  }, [visible])
  return { inChat: active && !away, visitNumber }
}

/** Deletes the space's seen vanishing messages when you come into the chat and again when you leave it. */
function useClearSeenAsYouComeAndGo(inChatWithVanishing: boolean, visitNumber: number, chat: ChatActions) {
  useEffect(() => {
    if (!inChatWithVanishing) return
    const clear = () => chat.clearSeenVanishing().catch(() => {})
    void clear()
    return () => {
      void clear()
    }
  }, [inChatWithVanishing, visitNumber, chat])
}

/** Calls `onSeen` with the candidates actually in view: scrolled to, with no sheet or photo viewer open over the chat. */
function useMarkSeenWhenInView(candidates: string[], scroller: RefObject<HTMLDivElement | null>, onSeen: (ids: string[]) => void) {
  const checkNow = useRef(() => {})
  checkNow.current = () => {
    const list = scroller.current
    if (!list || candidates.length === 0 || document.querySelector('dialog[open]')) return
    const inView = messageIdsInView(list)
    const ids = candidates.filter((id) => inView.has(id))
    if (ids.length > 0) onSeen(ids)
  }
  useEffect(() => checkNow.current(), [candidates])
  useEffect(() => {
    const list = scroller.current
    const recheck = () => checkNow.current()
    list?.addEventListener('scroll', recheck, { passive: true })
    // A sheet or the photo viewer closing shows the chat again.
    document.addEventListener('close', recheck, true)
    return () => {
      list?.removeEventListener('scroll', recheck)
      document.removeEventListener('close', recheck, true)
    }
  }, [scroller])
}

function VanishModeBanner() {
  const { space } = useSpace()
  if (!space?.vanish_mode) return null
  return (
    <div className="flex shrink-0 items-center justify-center gap-1.5 border-b border-line bg-surface-2 px-3 py-1.5 text-xs text-muted">
      <EyeOff className="size-3.5" />
      Vanish mode: new messages disappear once seen and the chat is closed.
    </div>
  )
}

/** Keeps the newest message in view while you're at the bottom, even as the keyboard opens. */
function useStickToBottom(ref: RefObject<HTMLDivElement | null>, messages: Message[], active: boolean) {
  const atBottom = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && active && atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, active])
  useEffect(() => {
    const viewport = window.visualViewport
    const follow = () => {
      const el = ref.current
      if (el && atBottom.current) el.scrollTop = el.scrollHeight
    }
    viewport?.addEventListener('resize', follow)
    return () => viewport?.removeEventListener('resize', follow)
  }, [])
  return {
    onScroll: (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      atBottom.current = distanceFromBottom < NEAR_BOTTOM_PX
    },
    /** Something's being sent: show it when it arrives. */
    stickToBottom: () => {
      atBottom.current = true
    },
  }
}

type MessageListProps = {
  messages: Message[]
  scroller: RefObject<HTMLDivElement | null>
  onScroll: (e: UIEvent<HTMLDivElement>) => void
  /** You're deleting this message. */
  onDeleting: (id: string) => void
}

function MessageList({ messages, scroller, onScroll, onDeleting }: MessageListProps) {
  const { userId } = useSpace()
  const [menuFor, setMenuFor] = useState<Message | null>(null)
  const [viewing, setViewing] = useState<Message | null>(null)
  return (
    <>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-3">
        <JoinPrompt />
        {messages.length === 0 && <ChatEmpty />}
        {messages.length > 0 && (
          <div className="mt-2 mb-1 flex items-center justify-center gap-1 text-xs text-muted">
            <Lock className="size-3" /> End-to-end encrypted
          </div>
        )}
        {messages.map((message, i) => (
          <MessageRow key={message.id} message={message} prev={messages[i - 1]} mine={message.sender_id === userId} onMenu={setMenuFor} onOpenMedia={setViewing} />
        ))}
      </div>
      <MessageMenu message={menuFor} mine={menuFor?.sender_id === userId} onClose={() => setMenuFor(null)} onDeleting={onDeleting} />
      <MediaViewer message={viewing} onClose={() => setViewing(null)} />
    </>
  )
}

function JoinPrompt() {
  const { partner, space } = useSpace()
  if (partner || !space?.invite_code) return null
  return (
    <div className="mx-auto my-4 max-w-sm rounded-2xl border border-line bg-surface p-4">
      <p className="mb-3 text-center text-sm">Your person hasn't joined yet. Send them the invite link:</p>
      <InviteCode code={space.invite_code} />
    </div>
  )
}

function ChatEmpty() {
  return (
    <EmptyState icon={<MessageCircleHeart />} title="Just the two of you">
      End-to-end encrypted: only your two phones can read this chat. Tap <Image className="inline size-4 align-text-bottom" /> for a
      view-once photo or video.
    </EmptyState>
  )
}

type BubbleProps = {
  message: Message
  mine: boolean
  grouped: boolean
  onMenu: (message: Message) => void
  onOpenMedia: (message: Message) => void
}

/** A message, with the day above it when it's the first that day. */
function MessageRow({ message, prev, ...bubble }: Omit<BubbleProps, 'grouped'> & { prev: Message | undefined }) {
  const startsNewDay = !prev || toLocalYMD(new Date(prev.created_at)) !== toLocalYMD(new Date(message.created_at))
  const closeToPrev = prev !== undefined && Date.parse(message.created_at) - Date.parse(prev.created_at) < GROUP_GAP_MS
  const grouped = !startsNewDay && prev?.sender_id === message.sender_id && closeToPrev
  return (
    <>
      {startsNewDay && <div className="my-4 text-center text-xs font-medium text-muted">{dayLabel(message.created_at)}</div>}
      <Bubble message={message} grouped={grouped} {...bubble} />
    </>
  )
}

function Bubble({ message, mine, grouped, onMenu, onOpenMedia }: BubbleProps) {
  const press = useLongPress(() => onMenu(message))
  return (
    <div data-message-id={message.id} className={cx('flex', mine ? 'justify-end' : 'justify-start', grouped ? 'mt-0.5' : 'mt-2.5')}>
      <div {...press} className={cx('no-callout max-w-[82%] transition-opacity', message.pending && 'opacity-60')}>
        <BubbleContent message={message} mine={mine} grouped={grouped} onOpenMedia={onOpenMedia} />
      </div>
    </div>
  )
}

function BubbleContent({ message, mine, grouped, onOpenMedia }: Omit<BubbleProps, 'onMenu'>) {
  const stamp = (
    <span className={cx('ml-2 inline-block translate-y-0.5 align-bottom text-[11px]', mine ? 'opacity-75' : 'text-muted')}>
      {message.pending ? 'sending…' : timeFmt.format(new Date(message.created_at))}
    </span>
  )
  if (message.locked || message.undecryptable) {
    return (
      <div className={cx('rounded-[1.25rem] border border-dashed border-line px-3.5 py-2 text-sm text-muted italic', mine ? 'rounded-br-md' : 'rounded-bl-md')}>
        {message.undecryptable ? "Couldn't decrypt this message" : 'Locked: unlock to read'}
        {stamp}
      </div>
    )
  }
  if (message.has_media) return <MediaBubble message={message} mine={mine} stamp={stamp} onOpen={onOpenMedia} />
  if (message.contact) return <ContactBubble card={message.contact} mine={mine} stamp={stamp} />
  if (message.body && ONE_TO_THREE_EMOJI.test(message.body.trim())) {
    return (
      <div className={cx('px-1', mine && 'text-right')}>
        <div className="text-5xl leading-tight">{message.body.trim()}</div>
        <div className="-mt-1 text-muted">{stamp}</div>
      </div>
    )
  }
  return <TextBubble body={message.body ?? ''} mine={mine} grouped={grouped} stamp={stamp} />
}

function TextBubble({ body, mine, grouped, stamp }: { body: string; mine: boolean; grouped: boolean; stamp: ReactNode }) {
  // The corner on the sender's side is squared: the top one when the bubble continues a group, else the bottom one.
  // Whole class names, so Tailwind finds them.
  let squaredCorner = grouped ? 'rounded-tl-md' : 'rounded-bl-md'
  if (mine) squaredCorner = grouped ? 'rounded-tr-md' : 'rounded-br-md'
  return (
    <div className={cx('rounded-[1.25rem] px-3.5 py-2 break-words whitespace-pre-wrap', mine ? 'bg-accent text-accent-ink' : 'border border-line bg-surface', squaredCorner)}>
      {/* URL_RE has one capture group, so split() keeps each URL, at the odd indexes. */}
      {body.split(URL_RE).map((part, i) => {
        const isUrl = i % 2 === 1
        if (!isUrl) return part
        return (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2 [overflow-wrap:anywhere]">
            {part}
          </a>
        )
      })}
      {stamp}
    </div>
  )
}

function ContactBubble({ card, mine, stamp }: { card: ContactCard; mine: boolean; stamp: ReactNode }) {
  return (
    <div className={cx('w-72 max-w-full rounded-[1.25rem] border p-3', mine ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface')}>
      <div className="flex items-center gap-3">
        <Avatar name={card.full_name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{card.full_name}</div>
          <div className="truncate text-sm text-muted">{card.phones[0] ?? card.emails[0] ?? card.company ?? 'Contact'}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" icon={<Download />} onClick={() => downloadVCard(card)} className="bg-surface">
          Save to phone
        </Button>
        <AddOrOpenContact card={card} />
      </div>
      <div className="mt-1 text-right">{stamp}</div>
    </div>
  )
}

function AddOrOpenContact({ card }: { card: ContactCard }) {
  const { contacts, actions } = useSpace()
  const nav = useNav()
  const { busy, run } = useBusy({ toast: true })
  const existing = findDuplicate(card, contacts)
  const add = () =>
    run(async () => {
      await actions.contacts.add({ ...toCard(card), tags: [], favorite: false })
      toast(`Added ${card.full_name} to contacts`)
    }, { idleAfterSuccess: true })
  if (existing) {
    return (
      <Button size="sm" variant="secondary" onClick={() => nav.openContact(existing.id)} className="bg-surface">
        Open
      </Button>
    )
  }
  return (
    <Button size="sm" variant="secondary" icon={<Plus />} loading={busy} onClick={add} className="bg-surface">
      Add to ours
    </Button>
  )
}

/** For a menu item: closes the menu, then does `task` and toasts how it went. */
function closeThen(onClose: () => void, task: () => Promise<unknown> | void, successToast?: string) {
  return async () => {
    onClose()
    try {
      await task()
      if (successToast) toast(successToast)
    } catch (e) {
      toastError(e)
    }
  }
}

function menuTitle(message: Message | null): string {
  if (message?.contact) return message.contact.full_name
  if (!message?.has_media) return 'Message'
  return message.media?.kind === 'video' ? 'Video' : 'Photo'
}

type MessageMenuProps = { message: Message | null; mine: boolean; onClose: () => void; onDeleting: (id: string) => void }

function MessageMenu({ message, mine, onClose, onDeleting }: MessageMenuProps) {
  const { actions, partner } = useSpace()
  const deleteMessage = (id: string) => {
    onDeleting(id)
    return actions.chat.remove(id)
  }
  return (
    <Sheet open={!!message} onClose={onClose} title={menuTitle(message)}>
      {message && (
        <div className="-mx-2">
          {message.body && <TextActions body={message.body} onClose={onClose} />}
          {message.contact && (
            <MenuItem icon={<Download />} onClick={closeThen(onClose, () => downloadVCard(message.contact!))}>
              Save to phone
            </MenuItem>
          )}
          {mine && !message.pending && (
            <MenuItem danger icon={<Trash />} onClick={closeThen(onClose, () => deleteMessage(message.id), 'Deleted')}>
              Delete for you and {partner?.display_name ?? 'them'}
            </MenuItem>
          )}
        </div>
      )}
    </Sheet>
  )
}

function TextActions({ body, onClose }: { body: string; onClose: () => void }) {
  const { actions } = useSpace()
  return (
    <>
      <MenuItem icon={<Copy />} onClick={closeThen(onClose, () => navigator.clipboard.writeText(body), 'Copied')}>
        Copy text
      </MenuItem>
      <MenuItem
        icon={<NotebookPen />}
        onClick={closeThen(onClose, () => actions.notes.add({ title: '', body, pinned: false }), 'Saved to Notes')}
      >
        Save as a note
      </MenuItem>
    </>
  )
}

type ComposerProps = { onSend: (message: OutgoingMessage) => Promise<void>; onSendMedia: (file: File) => void; onTyping: () => void }

function Composer({ onSend, onSendMedia, onTyping }: ComposerProps) {
  const [pickingContact, setPickingContact] = useState(false)
  const [fileToSend, setFileToSend] = useState<File | null>(null)
  const sendPickedContact = (contact: Contact) => {
    setPickingContact(false)
    onSend({ contact: toCard(contact) }).catch(toastError)
  }
  const sendMedia = (file: File) => {
    setFileToSend(null)
    onSendMedia(file)
  }
  return (
    <>
      <MessageForm onSend={(body) => onSend({ body })} onTyping={onTyping}>
        <MediaButton onPick={setFileToSend} />
        <IconButton label="Send a contact" onClick={() => setPickingContact(true)} className="-ml-1 text-muted">
          <ContactRound />
        </IconButton>
      </MessageForm>
      <MediaSendSheet file={fileToSend} onClose={() => setFileToSend(null)} onSend={sendMedia} />
      <Sheet open={pickingContact} onClose={() => setPickingContact(false)} title="Send a contact">
        <ContactPicker onPick={sendPickedContact} />
      </Sheet>
    </>
  )
}

function MediaButton({ onPick }: { onPick: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <IconButton label="Send a photo or video" onClick={() => input.current?.click()} className="text-muted">
        <ImagePlus />
      </IconButton>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        hidden
        aria-label="Photo or video to send"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onPick(file)
        }}
      />
    </>
  )
}

/** The message being typed: sent on submit, and put back if sending fails. */
function useDraft(onSend: (body: string) => Promise<void>, onTyping: () => void) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  function submit() {
    const body = text.trim()
    if (!body) return
    setText('')
    input.current?.focus()
    onSend(body).catch((e) => {
      // Put the message back, unless something new has been typed since.
      setText((current) => current || body)
      toastError(e)
    })
  }
  function change(value: string) {
    setText(value)
    if (value) onTyping()
  }
  return { text, input, submit, change }
}

function MessageForm({ onSend, onTyping, children }: { onSend: (body: string) => Promise<void>; onTyping: () => void; children: ReactNode }) {
  const draft = useDraft(onSend, onTyping)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        draft.submit()
      }}
      className="flex shrink-0 items-end gap-1 border-t border-line bg-bg px-2 py-2"
    >
      {children}
      <MessageInput inputRef={draft.input} value={draft.text} onChange={draft.change} onEnter={draft.submit} />
      <SendButton disabled={!draft.text.trim()} />
    </form>
  )
}

type MessageInputProps = { inputRef: RefObject<HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void; onEnter: () => void }

function MessageInput({ inputRef, value, onChange, onEnter }: MessageInputProps) {
  // Grows with the text, up to six lines.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`
  }, [inputRef, value])
  return (
    <textarea
      ref={inputRef}
      rows={1}
      value={value}
      placeholder="Message"
      aria-label="Message"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Enter sends on a keyboard; on phones it's a newline and the button sends.
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
          e.preventDefault()
          onEnter()
        }
      }}
      className="min-h-10 flex-1 resize-none rounded-[1.25rem] bg-surface-2 px-4 py-2 text-base leading-6 outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/30"
    />
  )
}

function SendButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      type="submit"
      aria-label="Send"
      disabled={disabled}
      // Keep the keyboard up: don't let the button steal focus from the textarea.
      onMouseDown={(e) => e.preventDefault()}
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition disabled:opacity-30"
    >
      <ArrowUp className="size-5" strokeWidth={2.5} />
    </button>
  )
}
