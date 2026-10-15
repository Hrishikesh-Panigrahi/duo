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
import { ArrowUp, ContactRound, Copy, Download, MessageCircleHeart, NotebookPen, Plus, Trash } from 'lucide-react'
import { time, useSpace } from '../lib/store'
import { toCard, type Contact, type Message } from '../lib/types'
import { downloadVCard, type ContactCard } from '../lib/vcard'
import { todayYMD } from '../lib/dates'
import { isTouch } from '../lib/device'
import { Avatar, Button, EmptyState, IconButton, MenuItem, Sheet, cx, toast, toastError } from '../components/ui'
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
        {messages.length === 0 ? (
          <EmptyState icon={<MessageCircleHeart />} title="Just the two of you">
            Messages here are only visible to you and {partner?.display_name ?? 'your person'}. Tap{' '}
            <ContactRound className="inline size-4 align-text-bottom" /> to send a contact.
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
                <Bubble message={m} mine={m.sender_id === userId} grouped={grouped} onMenu={setMenuFor} />
              </Fragment>
            )
          })
        )}
      </div>

      <Composer onSend={(body) => send({ body })} onAttach={() => setPicking(true)} onTyping={actions.typing} />

      <MessageMenu message={menuFor} mine={menuFor?.sender_id === userId} onClose={() => setMenuFor(null)} />

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
}: {
  message: Message
  mine: boolean
  grouped: boolean
  onMenu: (m: Message) => void
}) {
  const press = useLongPress(() => onMenu(m))
  const stamp = (
    <span className={cx('ml-2 inline-block translate-y-0.5 align-bottom text-[11px]', mine ? 'opacity-75' : 'text-muted')}>
      {m.pending ? 'sending…' : timeFmt.format(new Date(m.created_at))}
    </span>
  )

  let content
  if (m.contact) {
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
    <Sheet open={!!m} onClose={onClose} title={m?.contact ? m.contact.full_name : 'Message'}>
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
  onTyping,
}: {
  onSend: (body: string) => Promise<void>
  onAttach: () => void
  onTyping: () => void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

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
      <IconButton label="Send a contact" onClick={onAttach} className="text-muted">
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
