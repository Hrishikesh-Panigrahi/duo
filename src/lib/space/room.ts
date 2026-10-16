// The live room both of you are in while the app is open: who's online, who's typing, and the sealed
// signalling for direct transfers. A private Realtime channel that only the space's two members can use.
import { supabase } from '../supabase'
import { contexts, decryptRecord, encryptRecord } from '../e2e'
import { DirectLink, type LinkOptions, type Signal } from '../direct'

/** Older signalling messages are ignored, so a recorded one can't be replayed later. */
export const SIGNAL_MAX_AGE_MS = 2 * 60_000
/** One under the server's limit of 5 presence changes per 30 seconds; going over drops the room. */
export const PRESENCE_WINDOW_MS = 30_000
export const PRESENCE_MAX_PER_WINDOW = 4
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
  createLink?: (options: LinkOptions) => DirectLink
}

/** Sends presence only when it changes, and holds back bursts (flicking between apps) to stay under the limit. */
export class PresenceGate {
  private announced: string | null = null
  private wanted: string | null = null
  private sent: number[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly o: { send: (state: string | null) => void; canSend: () => boolean }) {}

  /** A JSON payload, or null for "not here". The latest one always gets through. */
  want(state: string | null) {
    this.wanted = state
    this.flush()
  }

  /** A new channel hasn't been told anything yet. */
  reset() {
    this.announced = null
  }

  stop() {
    clearTimeout(this.timer)
  }

  private flush() {
    clearTimeout(this.timer)
    if (!this.o.canSend() || this.wanted === this.announced) return
    const now = Date.now()
    this.sent = this.sent.filter((at) => now - at < PRESENCE_WINDOW_MS)
    if (this.sent.length >= PRESENCE_MAX_PER_WINDOW) {
      this.timer = setTimeout(() => this.flush(), PRESENCE_WINDOW_MS - (now - this.sent[0]) + 100)
      return
    }
    this.sent.push(now)
    this.announced = this.wanted
    this.o.send(this.wanted)
  }
}

// Until a leave finishes, the old channel still owns the name, so the next join waits for it.
let leaving: Promise<unknown> = Promise.resolve()

async function freeName(rt: RealtimeClient, name: string) {
  await leaving
  // A leave that timed out (say, offline) leaves the dead channel registered; clear it once more.
  const leftover = rt.getChannels().find((c) => c.topic === `realtime:${name}`)
  if (leftover) await rt.removeChannel(leftover as RoomChannel)
}

export class Room {
  private readonly rt: RealtimeClient
  private readonly name: string
  private readonly link: DirectLink
  private readonly presence: PresenceGate
  private channel: RoomChannel | null = null
  private subscribed = false
  private alive = true
  private rejoins = 0
  private rejoinTimer: ReturnType<typeof setTimeout> | undefined
  private partnerDirect = false
  private lastTyping = 0

  constructor(private readonly o: RoomOptions) {
    this.rt = o.realtime ?? (supabase as unknown as RealtimeClient)
    this.name = `room:${o.spaceId}`
    this.link = (o.createLink ?? ((options) => new DirectLink(options)))({
      selfId: o.userId,
      sendSignal: (signal) => this.sendSignal(signal),
      acceptFrom: o.isPartner,
      onFile: o.onFile,
    })
    this.presence = new PresenceGate({
      canSend: () => this.channel !== null && this.subscribed,
      send: (state) => void (state ? this.channel?.track(JSON.parse(state) as Record<string, unknown>) : this.channel?.untrack()),
    })
    void freeName(this.rt, this.name).then(() => this.open())
  }

  /** Visibility or this device's key changed. "Online" means the app is open in front of you. */
  syncPresence() {
    if (!this.channel || !this.subscribed) return
    const visible = this.o.isVisible?.() ?? document.visibilityState === 'visible'
    const direct = typeof RTCPeerConnection !== 'undefined' && this.o.getKey() !== null
    this.presence.want(visible ? JSON.stringify({ direct }) : null)
  }

  /** Throttled "is typing" ping to the other person. */
  typing() {
    const now = Date.now()
    if (now - this.lastTyping < TYPING_EVERY_MS) return
    this.lastTyping = now
    void this.channel?.send({ type: 'broadcast', event: 'typing', payload: { user_id: this.o.userId } })
  }

  /** Your person's app is open, unlocked, and can take a file directly. */
  partnerCanTakeFile() {
    return this.partnerDirect && typeof RTCPeerConnection !== 'undefined'
  }

  /** Resolves once their phone has stored the still-encrypted bytes. */
  sendFile(to: string, messageId: string, bytes: Uint8Array<ArrayBuffer>) {
    return this.link.sendFile(to, messageId, bytes)
  }

  close() {
    this.alive = false
    this.presence.stop()
    clearTimeout(this.rejoinTimer)
    this.link.close()
    this.partnerDirect = false
    if (this.channel) leaving = this.rt.removeChannel(this.channel)
    this.channel = null
  }

  private open() {
    if (!this.alive) return
    const ch = this.rt.channel(this.name, { config: { private: true, presence: { key: this.o.userId } } })
    this.channel = ch
    this.presence.reset()
    ch.on('presence', { event: 'sync' }, () => this.updatePartner(ch))
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.user_id !== this.o.userId) this.o.onTyping()
    })
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => this.receiveSignal(payload?.s))
    ch.subscribe((status) => this.onStatus(ch, status))
  }

  private updatePartner(ch: RoomChannel) {
    const others = Object.entries(ch.presenceState()).filter(([key]) => key !== this.o.userId)
    this.partnerDirect = others.some(([, metas]) => metas.some((m) => m.direct === true))
    this.o.onPartner({ online: others.length > 0, direct: this.partnerDirect })
  }

  private onStatus(ch: RoomChannel, status: string) {
    if (this.channel !== ch) return
    if (status !== 'SUBSCRIBED') return this.rejoin(ch)
    this.subscribed = true
    this.rejoins = 0
    this.syncPresence()
  }

  /** The server dropped the room (a rate limit, an expired session, a network change); backs off. */
  private rejoin(ch: RoomChannel) {
    this.subscribed = false
    this.partnerDirect = false
    if (!this.alive) return
    this.o.onPartner({ online: false, direct: false })
    this.channel = null
    leaving = this.rt.removeChannel(ch)
    clearTimeout(this.rejoinTimer)
    const delay = Math.min(MAX_REJOIN_DELAY_MS, 1_000 * 2 ** this.rejoins++)
    this.rejoinTimer = setTimeout(() => void freeName(this.rt, this.name).then(() => this.open()), delay)
  }

  private async sendSignal(signal: Signal) {
    const key = this.o.getKey()
    const channel = this.channel
    if (!key || !channel || !this.subscribed) throw new Error('Not connected')
    const sealed = await encryptRecord(key, contexts.signal(this.o.spaceId), { signal, at: Date.now() } satisfies SealedSignal)
    const res = await channel.send({ type: 'broadcast', event: 'signal', payload: { s: sealed } })
    if (res !== 'ok') throw new Error(`Couldn't reach the other phone (${res})`)
  }

  private receiveSignal(sealed: unknown) {
    const key = this.o.getKey()
    if (!key || typeof sealed !== 'string' || sealed.length > 64_000) return
    decryptRecord<SealedSignal>(key, contexts.signal(this.o.spaceId), sealed)
      .then(({ signal, at }) => {
        // Anything older is a replay of something recorded earlier.
        if (typeof at === 'number' && Math.abs(Date.now() - at) < SIGNAL_MAX_AGE_MS) this.link.handleSignal(signal)
      })
      .catch(() => {}) // not sealed with this space's key
  }
}

// Realtime channels don't survive hot-swapping this module, so in dev an edit here reloads the page.
import.meta.hot?.dispose(() => location.reload())
