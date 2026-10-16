// View-once photos and videos in the chat: the bubble, the send sheet, and the viewer that uses up the one view.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Film, Image, X } from 'lucide-react'
import { useSpace } from '../lib/store'
import type { Message } from '../lib/types'
import { PLAYABLE_TYPE, checkSize, isExpired } from '../lib/media'
import { Button, IconButton, Sheet, Spinner, cx, errorMessage } from '../components/ui'

type MediaBubbleProps = { message: Message; mine: boolean; stamp: ReactNode; onOpen: (message: Message) => void }

function mediaStatus(message: Message, mine: boolean, expired: boolean): string {
  if (message.pending) return 'Sending…'
  if (message.media_opened_at) return 'Opened'
  if (expired) return mine ? 'Expired without being opened' : 'Expired'
  return mine ? 'View once · not opened yet' : 'View once'
}

export function MediaBubble({ message, mine, stamp, onOpen }: MediaBubbleProps) {
  const isVideo = message.media?.kind === 'video'
  const kindName = isVideo ? 'Video' : 'Photo'
  const Icon = isVideo ? Film : Image
  const expired = !message.media_opened_at && isExpired(message.created_at)
  const canOpen = !mine && !message.pending && !message.media_opened_at && !expired
  const inner = (
    <>
      <span
        className={cx('flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-[18px]', canOpen ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted')}
      >
        <Icon />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block font-medium">{canOpen ? `Tap to view ${kindName.toLowerCase()}` : kindName}</span>
        <span className="block text-xs text-muted">{mediaStatus(message, mine, expired)}</span>
      </span>
      <span className="self-end text-muted">{stamp}</span>
    </>
  )
  const bubbleClass = 'flex w-64 max-w-full items-center gap-3 rounded-[1.25rem] border border-line bg-surface px-3 py-2.5 text-ink'
  if (!canOpen) return <div className={bubbleClass}>{inner}</div>
  return (
    <button type="button" onClick={() => onOpen(message)} className={cx(bubbleClass, 'transition hover:border-accent/50')}>
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
  if (!PLAYABLE_TYPE.test(file.type)) return 'Only photos and videos can be sent.'
  if (!file.type.startsWith('video/')) return null
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
    const previewUrl = URL.createObjectURL(file)
    setUrl(previewUrl)
    return () => URL.revokeObjectURL(previewUrl)
  }, [file])
  const isVideo = file.type.startsWith('video/')
  const problem = sendProblem(file)
  const showPreview = url && PLAYABLE_TYPE.test(file.type)
  return (
    <div className="space-y-4">
      <div className="flex max-h-[45dvh] justify-center overflow-hidden rounded-2xl bg-black">
        {showPreview && isVideo && <video src={url} controls muted playsInline className="max-h-[45dvh]" />}
        {showPreview && !isVideo && <img src={url} alt="" className="max-h-[45dvh] object-contain" />}
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
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (message && dialog && !dialog.open) dialog.showModal()
    if (!message && dialog?.open) dialog.close()
  }, [message])
  return (
    <dialog ref={dialogRef} className="viewer" onClose={onClose} onContextMenu={(e) => e.preventDefault()}>
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
    let createdUrl: string | null = null
    actions.chat
      .openMedia(message)
      .then((blobUrl) => {
        createdUrl = blobUrl
        if (alive) setUrl(blobUrl)
        else URL.revokeObjectURL(blobUrl)
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e))
      })
    return () => {
      alive = false
      if (createdUrl) URL.revokeObjectURL(createdUrl)
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
    actions.chat.deleteViewedMedia(message).catch(() => {})
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
        <ViewerContent url={url} error={error} isVideo={message.media?.kind === 'video'} onShown={onShown} />
      </div>
    </div>
  )
}

function ViewerContent({ url, error, isVideo, onShown }: { url: string | null; error: string | null; isVideo: boolean; onShown: () => void }) {
  if (error) return <p className="max-w-xs text-center text-sm text-white/80">{error}</p>
  if (!url) {
    return (
      <div className="flex flex-col items-center gap-3 text-sm text-white/70">
        <Spinner className="size-6 text-white/70" />
        Decrypting…
      </div>
    )
  }
  if (!isVideo) return <img src={url} alt="" draggable={false} onLoad={onShown} className="max-h-full max-w-full object-contain" />
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
