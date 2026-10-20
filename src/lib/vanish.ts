// Vanish mode, on this device. A message sent while a space is in vanish mode is deleted once it has been seen
// (the server's clear_seen_vanishing). While you're in the chat nothing disappears from under you: a "visit" lasts
// from opening the chat until you leave it, and the screen only loses vanished messages at the next visit.
import type { Message } from './types'

/** When a vanishing message counts as seen: a photo or video once it's opened, anything else once it's been read. */
function hasBeenSeen(message: Message): boolean {
  return Boolean(message.has_media ? message.media_opened_at : message.seen_at)
}

/** One stay in the chat, from opening it until leaving it. */
export class ChatVisit {
  /** For each vanishing message, whether it had already been seen when it first appeared during this visit. */
  private readonly seenWhenFirstShown = new Map<string, boolean>()
  /** Vanishing messages shown during this visit, so they stay on screen if they're deleted before you leave. */
  private readonly shown = new Map<string, Message>()
  /** Seen on this device during the visit, before the server's word about it arrives. */
  private readonly seenHere = new Set<string>()
  /** Deleted by you during the visit: these go at once. */
  private readonly letGoOf = new Set<string>()

  /** The messages to show now, oldest first. */
  visible(current: Message[]): Message[] {
    const visible: Message[] = []
    const stillThere = new Set<string>()
    for (const message of current) {
      stillThere.add(message.id)
      if (this.seenBeforeThisVisit(message)) continue
      if (message.vanishing) this.shown.set(message.id, message)
      visible.push(message)
    }
    for (const [id, message] of this.shown) {
      // Seen and then deleted while you were here: kept until you leave. An unseen one was deleted by its sender.
      const keep = !stillThere.has(id) && !this.letGoOf.has(id) && (hasBeenSeen(message) || this.seenHere.has(id))
      if (keep) visible.push(message)
    }
    return visible.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  }

  /** Notes messages you've just read here; returns the ones not noted before, which still need telling the server. */
  takeNewlySeen(ids: string[]): string[] {
    const fresh = ids.filter((id) => !this.seenHere.has(id))
    for (const id of fresh) this.seenHere.add(id)
    return fresh
  }

  /** You're deleting it yourself, so it shouldn't linger until you leave. */
  letGo(id: string) {
    this.letGoOf.add(id)
  }

  private seenBeforeThisVisit(message: Message): boolean {
    if (!message.vanishing) return false
    if (!this.seenWhenFirstShown.has(message.id)) this.seenWhenFirstShown.set(message.id, hasBeenSeen(message))
    return this.seenWhenFirstShown.get(message.id) === true
  }
}

/** Their vanishing messages that could be marked seen once they're in view. Photos and videos count once opened. */
export function vanishingToMarkSeen(visible: Message[], userId: string): string[] {
  const ids: string[] = []
  for (const message of visible) {
    const theirs = message.sender_id !== userId && !message.pending
    const readable = !message.locked && !message.undecryptable
    if (theirs && readable && message.vanishing && !message.has_media && !message.seen_at) ids.push(message.id)
  }
  return ids
}

/** Ids of the messages (rows marked `data-message-id`) at least half inside the list's visible area. */
export function messageIdsInView(list: HTMLElement): Set<string> {
  const area = list.getBoundingClientRect()
  const ids = new Set<string>()
  for (const row of list.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const box = row.getBoundingClientRect()
    const shownHeight = Math.min(box.bottom, area.bottom) - Math.max(box.top, area.top)
    if (shownHeight >= Math.min(box.height, area.height) / 2) ids.add(row.dataset.messageId!)
  }
  return ids
}
