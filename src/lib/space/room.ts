// The live room both of you are in while the app is open: who's online,
// who's typing, and the sealed signalling that sets up direct photo transfers
// (see direct.ts). It's a private Realtime channel, room:<space id>, that the
// database lets only the space's two members join, listen to or send on.
//
// The connection is passed in, so tests can drive it with a fake one.
import { supabase } from '../supabase'
import { contexts, decryptRecord, encryptRecord } from '../e2e'
import { createDirectLink, directSupported, type Signal } from '../direct'

/** Older signalling messages are ignored, so a recorded one can't be replayed later. */
export const SIGNAL_MAX_AGE_MS = 2 * 60_000
/** Presence changes allowed per window: one under the server's limit of 5 per 30 seconds. */
export const PRESENCE_WINDOW_MS = 30_000
export const PRESENCE_MAX_PER_WINDOW = 4
/** At most one "typing" ping this often. */
export const TYPING_EVERY_MS = 2500
const MAX_REJOIN_DELAY_MS = 30_000

type SealedSignal = { signal: Signal; at: number }

// The parts of a Supabase Realtime channel and client this uses.
export type RoomChannel = {
  topic: string
  on(type: 'presence', filter: { event: 'sync' }, cb: () => void): RoomChannel
  on(type: 'broadcast', filter: { event: string }, cb: (msg: { payload?: Record<string, unknown> }) => void): RoomChannel
  subscribe(cb: (status: string) => void): unknown
  presenceState(): Record<string, { direct?: boolean }[]>
  track(payload: Record<string, unknown>): Promise<unknown>
  untrack(): Promise<unknown>
  send(msg: { type: 'broadcast'; event: string; payload: Record<string, unknown> }): Promise<string>
}
export type RealtimeClient = {
  channel(name: string, opts: { config: { private: boolean; presence: { key: string } } }): RoomChannel
  removeChannel(channel: RoomChannel): Promise<unknown>
  getChannels(): { topic: string }[]
}

export type RoomOptions = {
  spaceId: string
  userId: string
  getKey: () => CryptoKey | null
  /** True for the other member of the space, the only one who may send us files. */
  isPartner: (userId: string) => boolean
  onPartner: (status: { online: boolean; direct: boolean }) => void
  onTyping: () => void
  /** Receives a directly delivered file, still encrypted; must have stored it when it resolves. */
  onFile: (messageId: string, bytes: ArrayBuffer) => Promise<void>
  isVisible?: () => boolean
  realtime?: RealtimeClient
  createLink?: typeof createDirectLink
}

export type Room = ReturnType<typeof joinRoom>

/**
 * Sends presence only when it changes, and holds back a burst of changes
 * (flicking between apps) so they stay under the server's limit, which drops
 * the room when it's exceeded. The latest wanted state always gets through.
 */
export function presenceGate(o: {
  send: (state: string | null) => void
  canSend: () => boolean
  windowMs?: number
  max?: number
  now?: () => number
}) {
  const windowMs = o.windowMs ?? PRESENCE_WINDOW_MS
  const max = o.max ?? PRESENCE_MAX_PER_WINDOW
  const now = o.now ?? Date.now
  let announced: string | null = null // what the room was last told; null = not there
  let wanted: string | null = null
  let sent: number[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    clearTimeout(timer)
    if (!o.canSend() || wanted === announced) return
    const t = now()
    sent = sent.filter((at) => t - at < windowMs)
    if (sent.length >= max) {
      timer = setTimeout(flush, windowMs - (t - sent[0]) + 100)
      return
    }
    sent.push(t)
    announced = wanted
    o.send(wanted)
  }

  return {
    /** The state to announce: a JSON payload, or null for "not here". */
    want(state: string | null) {
      wanted = state
      flush()
    },
    /** A new channel hasn't been told anything yet. */
    reset() {
      announced = null
    },
    stop() {
      clearTimeout(timer)
    },
  }
}

// Leaving a channel is async, and until it finishes the old channel still owns
// the name, so the next join waits for it.
let leaving: Promise<unknown> = Promise.resolve()

function leave(rt: RealtimeClient, channel: RoomChannel) {
  leaving = rt.removeChannel(channel)
}

async function ready(rt: RealtimeClient, name: string) {
  await leaving
  // If the leave timed out (say, offline), the dead channel is still
  // registered under the name; try once more to clear it.
  const leftover = rt.getChannels().find((c) => c.topic === `realtime:${name}`)
  if (leftover) await rt.removeChannel(leftover as RoomChannel)
}

export function joinRoom(o: RoomOptions) {
  const rt = o.realtime ?? (supabase as unknown as RealtimeClient)
  const name = `room:${o.spaceId}`
  const visible = o.isVisible ?? (() => document.visibilityState === 'visible')
  let alive = true
  let channel: RoomChannel | null = null
  let subscribed = false
  let rejoins = 0
  let rejoinTimer: ReturnType<typeof setTimeout> | undefined
  let partnerDirect = false
  let lastTyping = 0

  // Signalling is sealed with the space's key: only your person's phone can
  // read it or send it.
  const link = (o.createLink ?? createDirectLink)({
    selfId: o.userId,
    async sendSignal(signal) {
      const key = o.getKey()
      if (!key || !channel || !subscribed) throw new Error('Not connected')
      const sealed = await encryptRecord(key, contexts.signal(o.spaceId), { signal, at: Date.now() } satisfies SealedSignal)
      const res = await channel.send({ type: 'broadcast', event: 'signal', payload: { s: sealed } })
      if (res !== 'ok') throw new Error(`Couldn't reach the other phone (${res})`)
    },
    acceptFrom: o.isPartner,
    onFile: o.onFile,
  })

  // "Online" means the app is open in front of you, not just running somewhere.
  const presence = presenceGate({
    canSend: () => alive && channel !== null && subscribed,
    send: (state) => void (state ? channel!.track(JSON.parse(state) as Record<string, unknown>) : channel!.untrack()),
  })
  const syncPresence = () => {
    if (!alive || !channel || !subscribed) return
    presence.want(visible() ? JSON.stringify({ direct: directSupported() && o.getKey() !== null }) : null)
  }

  const open = () => {
    if (!alive) return
    const ch = rt.channel(name, { config: { private: true, presence: { key: o.userId } } })
    channel = ch
    presence.reset()

    ch.on('presence', { event: 'sync' }, () => {
      const others = Object.entries(ch.presenceState()).filter(([key]) => key !== o.userId)
      partnerDirect = others.some(([, metas]) => metas.some((m) => m.direct === true))
      o.onPartner({ online: others.length > 0, direct: partnerDirect })
    })
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.user_id !== o.userId) o.onTyping()
    })
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const key = o.getKey()
      const sealed: unknown = payload?.s
      if (!key || typeof sealed !== 'string' || sealed.length > 64_000) return
      decryptRecord<SealedSignal>(key, contexts.signal(o.spaceId), sealed)
        .then(({ signal, at }) => {
          // Anything older is a replay of something recorded earlier.
          if (typeof at === 'number' && Math.abs(Date.now() - at) < SIGNAL_MAX_AGE_MS) link.handleSignal(signal)
        })
        .catch(() => {}) // not sealed with this space's key: ignore it
    })
    ch.subscribe((status) => {
      if (channel !== ch) return
      if (status === 'SUBSCRIBED') {
        subscribed = true
        rejoins = 0
        syncPresence()
        return
      }
      // The server dropped the room (a rate limit, an expired session, a
      // network change): rejoin, backing off so a persistent problem doesn't
      // turn into a flood.
      subscribed = false
      partnerDirect = false
      if (!alive) return
      o.onPartner({ online: false, direct: false })
      channel = null
      leave(rt, ch)
      clearTimeout(rejoinTimer)
      rejoinTimer = setTimeout(() => void ready(rt, name).then(open), Math.min(MAX_REJOIN_DELAY_MS, 1_000 * 2 ** rejoins++))
    })
  }
  void ready(rt, name).then(open)

  return {
    /** Visibility or this device's key changed: tell the room. */
    syncPresence,

    /** Throttled "is typing" ping to the other person. */
    typing() {
      const t = Date.now()
      if (t - lastTyping < TYPING_EVERY_MS) return
      lastTyping = t
      void channel?.send({ type: 'broadcast', event: 'typing', payload: { user_id: o.userId } })
    },

    /** Your person's app is open, unlocked, and can take a file directly. */
    partnerCanTakeFile: () => partnerDirect && directSupported(),

    /** Sends encrypted bytes straight to their phone; resolves once it has stored them. */
    sendFile: (to: string, messageId: string, bytes: Uint8Array<ArrayBuffer>) => link.sendFile(to, messageId, bytes),

    close() {
      alive = false
      presence.stop()
      clearTimeout(rejoinTimer)
      link.close()
      partnerDirect = false
      if (channel) leave(rt, channel)
      channel = null
    },
  }
}

// Realtime channels don't survive hot-swapping this module mid-session, so in
// dev an edit here reloads the page instead.
import.meta.hot?.dispose(() => location.reload())
