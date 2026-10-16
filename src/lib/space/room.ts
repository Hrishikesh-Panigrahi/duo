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
const MAX_SEALED_SIGNAL_LENGTH = 64_000

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
  private sentAt: number[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly transport: { send: (state: string | null) => void; canSend: () => boolean }) {}

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
    if (!this.transport.canSend() || this.wanted === this.announced) return
    const now = Date.now()
    this.sentAt = this.sentAt.filter((at) => now - at < PRESENCE_WINDOW_MS)
    if (this.sentAt.length >= PRESENCE_MAX_PER_WINDOW) {
      // Tries again just after the oldest send leaves the window.
      const oldestSendAt = this.sentAt[0]
      const retryInMs = PRESENCE_WINDOW_MS - (now - oldestSendAt) + 100
      this.timer = setTimeout(() => this.flush(), retryInMs)
      return
    }
    this.sentAt.push(now)
    this.announced = this.wanted
    this.transport.send(this.wanted)
  }
}

// Until a leave finishes, the old channel still owns the name, so the next join waits for it.
let previousLeave: Promise<unknown> = Promise.resolve()

async function releaseRoomName(realtime: RealtimeClient, name: string) {
  await previousLeave
  // A leave that timed out (say, offline) leaves the dead channel registered; clear it once more.
  const leftover = realtime.getChannels().find((c) => c.topic === `realtime:${name}`)
  if (leftover) await realtime.removeChannel(leftover as RoomChannel)
}

export class Room {
  private readonly realtime: RealtimeClient
  private readonly name: string
  private readonly link: DirectLink
  private readonly presence: PresenceGate
  private channel: RoomChannel | null = null
  private subscribed = false
  private alive = true
  private rejoinAttempts = 0
  private rejoinTimer: ReturnType<typeof setTimeout> | undefined
  private partnerDirect = false
  private lastTyping = 0

  constructor(private readonly options: RoomOptions) {
    this.realtime = options.realtime ?? (supabase as unknown as RealtimeClient)
    this.name = `room:${options.spaceId}`
    const createLink = options.createLink ?? ((linkOptions) => new DirectLink(linkOptions))
    this.link = createLink({
      selfId: options.userId,
      sendSignal: (signal) => this.sendSignal(signal),
      acceptFrom: options.isPartner,
      onFile: options.onFile,
    })
    this.presence = new PresenceGate({
      canSend: () => this.channel !== null && this.subscribed,
      send: (state) => {
        if (state) void this.channel?.track(JSON.parse(state) as Record<string, unknown>)
        else void this.channel?.untrack()
      },
    })
    void releaseRoomName(this.realtime, this.name).then(() => this.join())
  }

  /** Visibility or this device's key changed. "Online" means the app is open in front of you. */
  syncPresence() {
    if (!this.channel || !this.subscribed) return
    const visible = this.options.isVisible?.() ?? document.visibilityState === 'visible'
    const direct = typeof RTCPeerConnection !== 'undefined' && this.options.getKey() !== null
    this.presence.want(visible ? JSON.stringify({ direct }) : null)
  }

  /** Throttled "is typing" ping to the other person. */
  sendTyping() {
    const now = Date.now()
    if (now - this.lastTyping < TYPING_EVERY_MS) return
    this.lastTyping = now
    void this.channel?.send({ type: 'broadcast', event: 'typing', payload: { user_id: this.options.userId } })
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
    if (this.channel) previousLeave = this.realtime.removeChannel(this.channel)
    this.channel = null
  }

  private join() {
    if (!this.alive) return
    const channel = this.realtime.channel(this.name, { config: { private: true, presence: { key: this.options.userId } } })
    this.channel = channel
    this.presence.reset()
    channel.on('presence', { event: 'sync' }, () => this.updatePartner(channel))
    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload?.user_id !== this.options.userId) this.options.onTyping()
    })
    channel.on('broadcast', { event: 'signal' }, ({ payload }) => this.receiveSignal(payload?.s))
    channel.subscribe((status) => this.onStatus(channel, status))
  }

  private updatePartner(channel: RoomChannel) {
    const others = Object.entries(channel.presenceState()).filter(([userId]) => userId !== this.options.userId)
    this.partnerDirect = others.some(([, presences]) => presences.some((presence) => presence.direct === true))
    this.options.onPartner({ online: others.length > 0, direct: this.partnerDirect })
  }

  private onStatus(channel: RoomChannel, status: string) {
    if (this.channel !== channel) return
    if (status !== 'SUBSCRIBED') return this.rejoin(channel)
    this.subscribed = true
    this.rejoinAttempts = 0
    this.syncPresence()
  }

  /** The server dropped the room (a rate limit, an expired session, a network change); backs off. */
  private rejoin(channel: RoomChannel) {
    this.subscribed = false
    this.partnerDirect = false
    if (!this.alive) return
    this.options.onPartner({ online: false, direct: false })
    this.channel = null
    previousLeave = this.realtime.removeChannel(channel)
    clearTimeout(this.rejoinTimer)
    const delay = Math.min(MAX_REJOIN_DELAY_MS, 1_000 * 2 ** this.rejoinAttempts)
    this.rejoinAttempts++
    this.rejoinTimer = setTimeout(() => void releaseRoomName(this.realtime, this.name).then(() => this.join()), delay)
  }

  private async sendSignal(signal: Signal) {
    const key = this.options.getKey()
    const channel = this.channel
    if (!key || !channel || !this.subscribed) throw new Error('Not connected')
    const sealed = await encryptRecord(key, contexts.signal(this.options.spaceId), { signal, at: Date.now() } satisfies SealedSignal)
    const res = await channel.send({ type: 'broadcast', event: 'signal', payload: { s: sealed } })
    if (res !== 'ok') throw new Error(`Couldn't reach the other phone (${res})`)
  }

  private receiveSignal(sealed: unknown) {
    const key = this.options.getKey()
    if (!key || typeof sealed !== 'string' || sealed.length > MAX_SEALED_SIGNAL_LENGTH) return
    decryptRecord<SealedSignal>(key, contexts.signal(this.options.spaceId), sealed)
      .then(({ signal, at }) => {
        // Anything older is a replay of something recorded earlier.
        if (typeof at === 'number' && Math.abs(Date.now() - at) < SIGNAL_MAX_AGE_MS) this.link.handleSignal(signal)
      })
      .catch(() => {}) // not sealed with this space's key
  }
}

// Realtime channels don't survive hot-swapping this module, so in dev an edit here reloads the page.
import.meta.hot?.dispose(() => location.reload())
