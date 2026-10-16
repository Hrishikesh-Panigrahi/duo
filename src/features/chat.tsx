import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { ArrowUp, ContactRound, Copy, Download, Film, Image, ImagePlus, Lock, MessageCircleHeart, NotebookPen, Plus, Trash, X } from 'lucide-react'
import { time, useSpace } from '../lib/store'
import { toCard, type Contact, type Message } from '../lib/types'
import { downloadVCard, type ContactCard } from '../lib/vcard'
import { todayYMD } from '../lib/dates'
import { isTouch } from '../lib/device'
import { Avatar, Button, EmptyState, IconButton, MenuItem, Sheet, Spinner, cx, errorMessage, toast, toastError } from '../components/ui'
import { MAX_MEDIA_BYTES, MEDIA_TTL_DAYS, checkSize, isExpired } from '../lib/media'
import { ContactPicker, findExisting } from './contacts'
import { InviteCode } from './space-setup'
import { useNav } from './nav'

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const dayYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

function dayLabel(iso: string) {
  const d = new Date(iso)
  const day = todayYMD(d)
  const now = new Date()
  if (day === todayYMD(now)) return 'Today'
  if (day === todayYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday'
  return (d.getFullYear() === now.getFullYear() ? dayFmt : dayYearFmt).format(d)
}

// Messages from the same person within a few minutes sit together.
const GROUP_GAP_MS = 3 * 60_000

export function ChatTab({ active }: { active: boolean }) {
  const { messages, userId, partner, space, actions } = useSpace()
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [menuFor, setMenuFor] = useState<Message | null>(null)
  const [picking, setPicking] = useState(false)
  const [mediaToSend, setMediaToSend] = useState<File | null>(null)
  const [viewing, setViewing] = useState<Message | null>(null)

  const scrollToEnd = () => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }

  useLayoutEffect(() => {
    if (active && atBottom.current) scrollToEnd()
  }, [messages, active])

  // The keyboard opening shrinks the viewport; keep the newest message in view.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => atBottom.current && scrollToEnd()
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  async function send(input: { body?: string; contact?: ContactCard }) {
    atBottom.current = true
    await actions.sendMessage(input)
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-3"
      >
        {!partner && space?.invite_code && (
          <div className="mx-auto my-4 max-w-sm rounded-2xl border border-line bg-surface p-4">
            <p className="mb-3 text-center text-sm">Your person hasn't joined yet. Send them this code:</p>
            <InviteCode code={space.invite_code} />
          </div>
        )}
        {messages.length > 0 && (
          <div className="mt-2 mb-1 flex items-center justify-center gap-1 text-xs text-muted">
            <Lock className="size-3" /> End-to-end encrypted
          </div>
        )}
        {messages.length === 0 ? (
          <EmptyState icon={<MessageCircleHeart />} title="Just the two of you">
            End-to-end encrypted: only your two phones can read this chat. Tap{' '}
            <Image className="inline size-4 align-text-bottom" /> for a view-once photo or video.
          </EmptyState>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1]
            const newDay = !prev || todayYMD(new Date(prev.created_at)) !== todayYMD(new Date(m.created_at))
            const grouped =
              !newDay && prev.sender_id === m.sender_id && time(m.created_at) - time(prev.created_at) < GROUP_GAP_MS
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="my-4 text-center text-xs font-medium text-muted">{dayLabel(m.created_at)}</div>
                )}
                <Bubble message={m} mine={m.sender_id === userId} grouped={grouped} onMenu={setMenuFor} onOpenMedia={setViewing} />
              </Fragment>
            )
          })
        )}
      </div>

      <Composer
        onSend={(body) => send({ body })}
        onAttach={() => setPicking(true)}
        onPickMedia={setMediaToSend}
        onTyping={actions.typing}
      />

      <MessageMenu message={menuFor} mine={menuFor?.sender_id === userId} onClose={() => setMenuFor(null)} />

      <MediaSendSheet
        file={mediaToSend}
        onClose={() => setMediaToSend(null)}
        onSend={(file) => {
          atBottom.current = true
          setMediaToSend(null)
          actions.sendMedia(file).catch(toastError)
        }}
      />
      <MediaViewer message={viewing} onClose={() => setViewing(null)} />

      <Sheet open={picking} onClose={() => setPicking(false)} title="Send a contact">
        <ContactPicker
          onPick={(c: Contact) => {
            setPicking(false)
            send({ contact: toCard(c) }).catch(toastError)
          }}
        />
      </Sheet>
    </div>
  )
}

/** Long-press on touch, right-click on desktop. */
function useLongPress(onLongPress: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const cancel = () => {
    clearTimeout(timer.current)
    origin.current = null
  }
  const fire = () => {
    if (fired.current) return
    fired.current = true
    navigator.vibrate?.(10)
    onLongPress()
  }
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      fired.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(fire, ms)
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault()
      cancel()
      fire()
    },
    // A long-press shouldn't also follow a link inside the bubble.
    onClickCapture: (e: ReactMouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
        fired.current = false
      }
    },
  }
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]}!?])/g

function Linkified({ text }: { text: string }) {
  return text.split(URL_RE).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2 [overflow-wrap:anywhere]">
        {part}
      </a>
    ) : (
      part
    ),
  )
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}️?)*\s*){1,3}$/u

function Bubble({
  message: m,
  mine,
  grouped,
  onMenu,
  onOpenMedia,
}: {
  message: Message
  mine: boolean
  grouped: boolean
  onMenu: (m: Message) => void
  onOpenMedia: (m: Message) => void
}) {
  const press = useLongPress(() => onMenu(m))
  const stamp = (
    <span className={cx('ml-2 inline-block translate-y-0.5 align-bottom text-[11px]', mine ? 'opacity-75' : 'text-muted')}>
      {m.pending ? 'sending…' : timeFmt.format(new Date(m.created_at))}
    </span>
  )

  let content
  if (m.locked || m.undecryptable) {
    content = (
      <div
        className={cx(
          'rounded-[1.25rem] border border-dashed border-line px-3.5 py-2 text-sm text-muted italic',
          mine ? 'rounded-br-md' : 'rounded-bl-md',
        )}
      >
        {m.undecryptable ? "Couldn't decrypt this message" : 'Locked: unlock to read'}
        {stamp}
      </div>
    )
  } else if (m.has_media) {
    content = <MediaBubble message={m} mine={mine} stamp={stamp} onOpen={onOpenMedia} />
  } else if (m.contact) {
    content = <ContactBubble card={m.contact} mine={mine} stamp={stamp} />
  } else if (m.body && EMOJI_ONLY.test(m.body.trim())) {
    content = (
      <div className={cx('px-1', mine && 'text-right')}>
        <div className="text-5xl leading-tight">{m.body.trim()}</div>
        <div className="-mt-1 text-muted">{stamp}</div>
      </div>
    )
  } else {
    content = (
      <div
        className={cx(
          'rounded-[1.25rem] px-3.5 py-2 break-words whitespace-pre-wrap',
          mine ? 'bg-accent text-accent-ink' : 'border border-line bg-surface',
          mine ? (grouped ? 'rounded-tr-md' : 'rounded-br-md') : grouped ? 'rounded-tl-md' : 'rounded-bl-md',
        )}
      >
        <Linkified text={m.body ?? ''} />
        {stamp}
      </div>
    )
  }

  return (
    <div className={cx('flex', mine ? 'justify-end' : 'justify-start', grouped ? 'mt-0.5' : 'mt-2.5')}>
      <div {...press} className={cx('no-callout max-w-[82%] transition-opacity', m.pending && 'opacity-60')}>
        {content}
      </div>
    </div>
  )
}

function ContactBubble({ card, mine, stamp }: { card: ContactCard; mine: boolean; stamp: ReactNode }) {
  const { contacts, actions } = useSpace()
  const nav = useNav()
  const existing = findExisting(card, contacts)
  const [adding, setAdding] = useState(false)

  async function addToOurs() {
    setAdding(true)
    try {
      await actions.addContact({ ...toCard(card), tags: [], favorite: false })
      toast(`Added ${card.full_name} to contacts`)
    } catch (e) {
      toastError(e)
    } finally {
      setAdding(false)
    }
  }

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
        {existing ? (
          <Button size="sm" variant="secondary" onClick={() => nav.openContact(existing.id)} className="bg-surface">
            Open
          </Button>
        ) : (
          <Button size="sm" variant="secondary" icon={<Plus />} loading={adding} onClick={addToOurs} className="bg-surface">
            Add to ours
          </Button>
        )}
      </div>
      <div className="mt-1 text-right">{stamp}</div>
    </div>
  )
}

function MessageMenu({ message, mine, onClose }: { message: Message | null; mine: boolean; onClose: () => void }) {
  const { actions, partner } = useSpace()
  const run = (fn: () => Promise<unknown> | void, done?: string) => async () => {
    onClose()
    try {
      await fn()
      if (done) toast(done)
    } catch (e) {
      toastError(e)
    }
  }
  const m = message
  return (
    <Sheet
      open={!!m}
      onClose={onClose}
      title={m?.contact ? m.contact.full_name : m?.has_media ? (m.media?.kind === 'video' ? 'Video' : 'Photo') : 'Message'}
    >
      {m && (
        <div className="-mx-2">
          {m.body && (
            <>
              <MenuItem icon={<Copy />} onClick={run(() => navigator.clipboard.writeText(m.body!), 'Copied')}>
                Copy text
              </MenuItem>
              <MenuItem
                icon={<NotebookPen />}
                onClick={run(() => actions.addNote({ title: '', body: m.body!, pinned: false }), 'Saved to Notes')}
              >
                Save as a note
              </MenuItem>
            </>
          )}
          {m.contact && (
            <MenuItem icon={<Download />} onClick={run(() => downloadVCard(m.contact!))}>
              Save to phone
            </MenuItem>
          )}
          {mine && !m.pending && (
            <MenuItem
              danger
              icon={<Trash />}
              onClick={run(() => actions.deleteMessage(m.id), 'Deleted')}
            >
              Delete for you and {partner?.display_name ?? 'them'}
            </MenuItem>
          )}
        </div>
      )}
    </Sheet>
  )
}

function Composer({
  onSend,
  onAttach,
  onPickMedia,
  onTyping,
}: {
  onSend: (body: string) => Promise<void>
  onAttach: () => void
  onPickMedia: (file: File) => void
  onTyping: () => void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`
  }, [text])

  function submit() {
    const body = text.trim()
    if (!body) return
    setText('')
    ref.current?.focus()
    onSend(body).catch((e) => {
      setText((t) => t || body)
      toastError(e)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex shrink-0 items-end gap-1 border-t border-line bg-bg px-2 py-2"
    >
      <IconButton label="Send a photo or video" onClick={() => fileInput.current?.click()} className="text-muted">
        <ImagePlus />
      </IconButton>
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        hidden
        aria-label="Photo or video to send"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onPickMedia(file)
        }}
      />
      <IconButton label="Send a contact" onClick={onAttach} className="-ml-1 text-muted">
        <ContactRound />
      </IconButton>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder="Message"
        aria-label="Message"
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value) onTyping()
        }}
        onKeyDown={(e) => {
          // Enter sends on a keyboard; on phones it's a newline and the button sends.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
            e.preventDefault()
            submit()
          }
        }}
        className="min-h-10 flex-1 resize-none rounded-[1.25rem] bg-surface-2 px-4 py-2 text-base leading-6 outline-none placeholder:text-muted focus:ring-2 focus:ring-accent/30"
      />
      <button
        type="submit"
        aria-label="Send"
        disabled={!text.trim()}
        // Keep the keyboard up: don't let the button steal focus from the textarea.
        onMouseDown={(e) => e.preventDefault()}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition disabled:opacity-30"
      >
        <ArrowUp className="size-5" strokeWidth={2.5} />
      </button>
    </form>
  )
}

// ─── View-once photos and videos ───────────────────────────────────────

function MediaBubble({ message: m, mine, stamp, onOpen }: { message: Message; mine: boolean; stamp: ReactNode; onOpen: (m: Message) => void }) {
  const video = m.media?.kind === 'video'
  const Icon = video ? Film : Image
  const what = video ? 'video' : 'photo'
  const expired = !m.media_opened_at && isExpired(m.created_at)
  const canOpen = !mine && !m.pending && !m.media_opened_at && !expired
  const status = m.pending
    ? 'Sending…'
    : m.media_opened_at
      ? 'Opened'
      : expired
        ? mine ? 'Expired without being opened' : 'Expired'
        : mine ? 'View once · not opened yet' : 'View once'

  const inner = (
    <>
      <span
        className={cx(
          'flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-[18px]',
          canOpen ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted',
        )}
      >
        <Icon />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block font-medium">{canOpen ? `Tap to view ${what}` : video ? 'Video' : 'Photo'}</span>
        <span className="block text-xs text-muted">{status}</span>
      </span>
      <span className="self-end text-muted">{stamp}</span>
    </>
  )
  const cls = 'flex w-64 max-w-full items-center gap-3 rounded-[1.25rem] border border-line bg-surface px-3 py-2.5 text-ink'
  return canOpen ? (
    <button type="button" onClick={() => onOpen(m)} className={cx(cls, 'transition hover:border-accent/50')}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

function MediaSendSheet({ file, onClose, onSend }: { file: File | null; onClose: () => void; onSend: (file: File) => void }) {
  const video = file?.type.startsWith('video/')
  return (
    <Sheet open={!!file} onClose={onClose} title={video ? 'Send a video' : 'Send a photo'}>
      {file && <MediaSendBody file={file} onSend={onSend} />}
    </Sheet>
  )
}

function MediaSendBody({ file, onSend }: { file: File; onSend: (file: File) => void }) {
  const { partner } = useSpace()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  const video = file.type.startsWith('video/')
  const supported = video || file.type.startsWith('image/')
  let problem: string | null = supported ? null : 'Only photos and videos can be sent.'
  if (video) {
    try {
      checkSize(file.size, 'video')
    } catch (e) {
      problem = errorMessage(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex max-h-[45dvh] justify-center overflow-hidden rounded-2xl bg-black">
        {url && supported && (video ? <video src={url} controls muted playsInline className="max-h-[45dvh]" /> : <img src={url} alt="" className="max-h-[45dvh] object-contain" />)}
      </div>
      <p className="text-sm text-muted">
        <strong className="text-ink">View once.</strong> {partner?.display_name ?? 'Your person'} can open it one time, then it's
        deleted. If it isn't opened within {MEDIA_TTL_DAYS} days, it's deleted anyway. It's encrypted on this phone before it's
        sent{video ? `; videos can be up to ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)} MB` : ''}.
      </p>
      {problem && <p className="text-sm text-danger">{problem}</p>}
      <Button className="w-full" disabled={!!problem} onClick={() => onSend(file)}>
        Send view once
      </Button>
    </div>
  )
}

/** Full-screen, one-time viewer. Opening it is what uses up the one view. */
function MediaViewer({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (message && !d.open) d.showModal()
    if (!message && d.open) d.close()
  }, [message])
  return (
    <dialog ref={ref} className="viewer" onClose={onClose} onContextMenu={(e) => e.preventDefault()}>
      {message && <ViewerBody message={message} onClose={onClose} />}
    </dialog>
  )
}

function ViewerBody({ message, onClose }: { message: Message; onClose: () => void }) {
  const { actions } = useSpace()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const used = useRef(false)

  useEffect(() => {
    let alive = true
    let made: string | null = null
    actions
      .openMedia(message)
      .then((u) => {
        made = u
        if (alive) setUrl(u)
        else URL.revokeObjectURL(u)
      })
      .catch((e) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [message, actions])

  // It counts as opened once it's on screen: the file is deleted right then,
  // so closing the app mid-view can't keep it around for a second look.
  const onShown = () => {
    if (used.current) return
    used.current = true
    actions.finishMedia(message).catch(() => {})
  }

  const video = message.media?.kind === 'video'
  return (
    <div className="no-callout flex h-full flex-col bg-black text-white">
      <div className="flex shrink-0 items-center gap-2 px-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2">
        <IconButton label="Close" onClick={onClose} className="text-white hover:bg-white/10">
          <X />
        </IconButton>
        <span className="text-sm text-white/70">View once: this closes for good</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        {error ? (
          <p className="max-w-xs text-center text-sm text-white/80">{error}</p>
        ) : !url ? (
          <div className="flex flex-col items-center gap-3 text-sm text-white/70">
            <Spinner className="size-6 text-white/70" />
            Decrypting…
          </div>
        ) : video ? (
          <video
            src={url}
            autoPlay
            playsInline
            controls
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            onLoadedData={onShown}
            className="max-h-full max-w-full"
          />
        ) : (
          <img src={url} alt="" draggable={false} onLoad={onShown} className="max-h-full max-w-full object-contain" />
        )}
      </div>
    </div>
  )
}
