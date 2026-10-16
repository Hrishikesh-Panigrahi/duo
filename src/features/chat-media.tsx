// View-once photos and videos in the chat: the bubble, the send sheet, and the viewer that uses up the one view.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Film, Image, X } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { Message } from '../lib/types'
import { checkSize, isExpired } from '../lib/media'
import { Button, IconButton, Sheet, Spinner, cx, errorMessage } from '../components/ui'

type MediaBubbleProps = { message: Message; mine: boolean; stamp: ReactNode; onOpen: (m: Message) => void }

function mediaStatus(m: Message, mine: boolean, expired: boolean): string {
  if (m.pending) return 'Sending…'
  if (m.media_opened_at) return 'Opened'
  if (expired) return mine ? 'Expired without being opened' : 'Expired'
  return mine ? 'View once · not opened yet' : 'View once'
}

export function MediaBubble({ message: m, mine, stamp, onOpen }: MediaBubbleProps) {
  const video = m.media?.kind === 'video'
  const Icon = video ? Film : Image
  const expired = !m.media_opened_at && isExpired(m.created_at)
  const canOpen = !mine && !m.pending && !m.media_opened_at && !expired
  const inner = (
    <>
      <span
        className={cx('flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-[18px]', canOpen ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted')}
      >
        <Icon />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block font-medium">{canOpen ? `Tap to view ${video ? 'video' : 'photo'}` : video ? 'Video' : 'Photo'}</span>
        <span className="block text-xs text-muted">{mediaStatus(m, mine, expired)}</span>
      </span>
      <span className="self-end text-muted">{stamp}</span>
    </>
  )
  const cls = 'flex w-64 max-w-full items-center gap-3 rounded-[1.25rem] border border-line bg-surface px-3 py-2.5 text-ink'
  if (!canOpen) return <div className={cls}>{inner}</div>
  return (
    <button type="button" onClick={() => onOpen(m)} className={cx(cls, 'transition hover:border-accent/50')}>
      {inner}
    </button>
  )
}

export function MediaSendSheet({ file, onClose, onSend }: { file: File | null; onClose: () => void; onSend: (file: File) => void }) {
  return (
    <Sheet open={!!file} onClose={onClose}>
      {file && <MediaSendBody file={file} onSend={onSend} />}
    </Sheet>
  )
}

/** Why this file can't be sent, or null. */
function sendProblem(file: File): string | null {
  if (!file.type.startsWith('video/')) return file.type.startsWith('image/') ? null : 'Only photos and videos can be sent.'
  try {
    checkSize(file.size, 'video')
    return null
  } catch (e) {
    return errorMessage(e)
  }
}

function MediaSendBody({ file, onSend }: { file: File; onSend: (file: File) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  const video = file.type.startsWith('video/')
  const problem = sendProblem(file)
  const showPreview = url && (video || file.type.startsWith('image/'))
  return (
    <div className="space-y-4">
      <div className="flex max-h-[45dvh] justify-center overflow-hidden rounded-2xl bg-black">
        {showPreview && video && <video src={url} controls muted playsInline className="max-h-[45dvh]" />}
        {showPreview && !video && <img src={url} alt="" className="max-h-[45dvh] object-contain" />}
      </div>
      {problem && <p className="text-sm text-danger">{problem}</p>}
      <Button className="w-full" disabled={!!problem} onClick={() => onSend(file)}>
        Send
      </Button>
    </div>
  )
}

/** Full-screen, one-time viewer. Opening it is what uses up the one view. */
export function MediaViewer({ message, onClose }: { message: Message | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (message && d && !d.open) d.showModal()
    if (!message && d?.open) d.close()
  }, [message])
  return (
    <dialog ref={ref} className="viewer" onClose={onClose} onContextMenu={(e) => e.preventDefault()}>
      {message && <ViewerBody message={message} onClose={onClose} />}
    </dialog>
  )
}

/** Decrypts the file into a URL that only works on this page, and revokes it when done. */
function useDecryptedMedia(message: Message) {
  const { actions } = useSpace()
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    actions.chat
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
  return { url, error }
}

function ViewerBody({ message, onClose }: { message: Message; onClose: () => void }) {
  const { actions } = useSpace()
  const { url, error } = useDecryptedMedia(message)
  const used = useRef(false)
  // It counts as opened once it's on screen: the file is deleted right then, so closing mid-view can't keep it.
  const onShown = () => {
    if (used.current) return
    used.current = true
    actions.chat.finishMedia(message).catch(() => {})
  }
  return (
    <div className="no-callout flex h-full flex-col bg-black text-white">
      <div className="flex shrink-0 items-center gap-2 px-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2">
        <IconButton label="Close" onClick={onClose} className="text-white hover:bg-white/10">
          <X />
        </IconButton>
        <span className="text-sm text-white/70">View once: this closes for good</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        <ViewerContent url={url} error={error} video={message.media?.kind === 'video'} onShown={onShown} />
      </div>
    </div>
  )
}

function ViewerContent({ url, error, video, onShown }: { url: string | null; error: string | null; video: boolean; onShown: () => void }) {
  if (error) return <p className="max-w-xs text-center text-sm text-white/80">{error}</p>
  if (!url) {
    return (
      <div className="flex flex-col items-center gap-3 text-sm text-white/70">
        <Spinner className="size-6 text-white/70" />
        Decrypting…
      </div>
    )
  }
  if (!video) return <img src={url} alt="" draggable={false} onLoad={onShown} className="max-h-full max-w-full object-contain" />
  return (
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
  )
}
