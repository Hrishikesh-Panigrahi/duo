// Sends already-encrypted files phone to phone over WebRTC; if that fails, the caller uses Storage.
// Only STUN, deliberately no TURN relay: a file goes phone to phone or not at all.

export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]
/** Safe for every browser's data channel message size. */
export const CHUNK_BYTES = 16 * 1024
const CONNECT_TIMEOUT_MS = 8_000
const TRANSFER_TIMEOUT_MS = 120_000
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_INCOMING = 4
const STORED = 'stored'

type Route = { session: string; from: string; to: string }
type Offer = Route & { type: 'offer'; sdp: RTCSessionDescriptionInit }
export type Signal =
  | Offer
  | (Route & { type: 'answer'; sdp: RTCSessionDescriptionInit })
  | (Route & { type: 'ice'; candidate: RTCIceCandidateInit })
  | (Route & { type: 'bye' })

export type Header = { messageId: string; size: number }

export type LinkOptions = {
  selfId: string
  sendSignal: (s: Signal) => Promise<void>
  /** Only the other member of the space may send us files. */
  acceptFrom: (userId: string) => boolean
  /** Receives the still-encrypted bytes; must have stored them when it resolves. */
  onFile: (messageId: string, bytes: ArrayBuffer) => Promise<void>
}

type Link = LinkOptions & { sessions: Map<string, Transfer>; signalQuietly: (s: Signal) => void }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The first data channel message names the file and its size; anything else is refused. */
export function parseHeader(data: unknown): Header | null {
  if (typeof data !== 'string') return null
  try {
    const h = JSON.parse(data) as Partial<Header>
    if (typeof h.messageId !== 'string' || !UUID.test(h.messageId)) return null
    if (typeof h.size !== 'number' || !Number.isInteger(h.size) || h.size <= 0 || h.size > MAX_FILE_BYTES) return null
    return { messageId: h.messageId, size: h.size }
  } catch {
    return null
  }
}

export function joinChunks(parts: ArrayBuffer[], size: number): ArrayBuffer {
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(new Uint8Array(p), at)
    at += p.byteLength
  }
  return out.buffer
}

/** Rebuilds one file from a data channel: a header, then exactly that many bytes. */
export class FileAssembler {
  private header: Header | null = null
  private parts: ArrayBuffer[] = []
  private received = 0

  /** The finished file, 'invalid' for anything unexpected, or null while there's more to come. */
  take(data: unknown): { messageId: string; bytes: ArrayBuffer } | 'invalid' | null {
    if (!this.header) {
      this.header = parseHeader(data)
      return this.header ? null : 'invalid'
    }
    if (!(data instanceof ArrayBuffer)) return 'invalid'
    this.parts.push(data)
    this.received += data.byteLength
    if (this.received > this.header.size) return 'invalid'
    if (this.received < this.header.size) return null
    const bytes = joinChunks(this.parts, this.received)
    this.parts = []
    return { messageId: this.header.messageId, bytes }
  }
}

/** One peer connection, from offer to close, in either direction. */
abstract class Transfer {
  readonly pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  private pendingIce: RTCIceCandidateInit[] = []
  private remoteSet = false
  private answered = false
  private ended = false

  constructor(
    protected readonly link: Link,
    protected readonly route: Route,
  ) {
    link.sessions.set(route.session, this)
    this.pc.onicecandidate = (e) => {
      if (e.candidate) link.signalQuietly({ ...route, type: 'ice', candidate: e.candidate.toJSON() })
    }
  }

  abstract abort(): void

  acceptAnswer(sdp: RTCSessionDescriptionInit) {
    // If they're signed in on two devices, both answer; the first one wins.
    if (this.answered) return
    this.answered = true
    this.addRemote(sdp).catch(() => this.abort())
  }

  addIce(candidate: RTCIceCandidateInit) {
    if (this.remoteSet) void this.pc.addIceCandidate(candidate).catch(() => {})
    else this.pendingIce.push(candidate)
  }

  protected async addRemote(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(sdp)
    this.remoteSet = true
    for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c).catch(() => {})
  }

  protected async sendDescription(type: 'offer' | 'answer') {
    await this.pc.setLocalDescription(type === 'offer' ? await this.pc.createOffer() : await this.pc.createAnswer())
    await this.link.sendSignal({ ...this.route, type, sdp: this.pc.localDescription!.toJSON() })
  }

  /** False if it had already ended. */
  protected end(): boolean {
    if (this.ended) return false
    this.ended = true
    this.link.sessions.delete(this.route.session)
    return true
  }
}

class OutgoingTransfer extends Transfer {
  readonly done: Promise<void>
  private readonly dc: RTCDataChannel
  private settle: (err?: Error) => void = () => {}
  private readonly connectTimer = setTimeout(() => this.finish(new Error("Couldn't connect directly")), CONNECT_TIMEOUT_MS)
  private readonly transferTimer = setTimeout(() => this.finish(new Error('Direct transfer took too long')), TRANSFER_TIMEOUT_MS)

  constructor(link: Link, to: string, messageId: string, bytes: Uint8Array<ArrayBuffer>) {
    super(link, { session: crypto.randomUUID(), from: link.selfId, to })
    this.done = new Promise((resolve, reject) => (this.settle = (err) => (err ? reject(err) : resolve())))
    this.dc = this.pc.createDataChannel('media', { ordered: true })
    this.dc.binaryType = 'arraybuffer'
    this.dc.bufferedAmountLowThreshold = 1 << 20
    this.dc.onopen = () => void this.upload(messageId, bytes)
    this.dc.onclose = () => this.finish(new Error('The direct connection closed early'))
    this.dc.onmessage = (e) => {
      if (e.data === STORED) this.finish()
    }
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this.finish(new Error("Couldn't connect directly"))
    }
    this.sendDescription('offer').catch((e: Error) => this.finish(e))
  }

  abort() {
    this.finish(new Error('The other phone stopped the transfer'))
  }

  private async upload(messageId: string, bytes: Uint8Array<ArrayBuffer>) {
    clearTimeout(this.connectTimer)
    try {
      this.dc.send(JSON.stringify({ messageId, size: bytes.byteLength } satisfies Header))
      for (let at = 0; at < bytes.byteLength; at += CHUNK_BYTES) {
        if (this.dc.bufferedAmount > this.dc.bufferedAmountLowThreshold) {
          await new Promise((r) => this.dc.addEventListener('bufferedamountlow', r, { once: true }))
        }
        this.dc.send(bytes.subarray(at, at + CHUNK_BYTES))
      }
    } catch (e) {
      this.finish(e as Error)
    }
  }

  private finish(err?: Error) {
    if (!this.end()) return
    clearTimeout(this.connectTimer)
    clearTimeout(this.transferTimer)
    try {
      this.dc.close()
    } catch {
      // already closed
    }
    this.pc.close()
    if (err) this.link.signalQuietly({ ...this.route, type: 'bye' })
    this.settle(err)
  }
}

class IncomingTransfer extends Transfer {
  private readonly timer = setTimeout(() => this.abort(), TRANSFER_TIMEOUT_MS)

  constructor(link: Link, offer: Offer) {
    super(link, { session: offer.session, from: link.selfId, to: offer.from })
    this.pc.ondatachannel = (e) => this.receive(e.channel)
    this.answer(offer.sdp).catch(() => this.abort())
  }

  abort() {
    if (!this.end()) return
    clearTimeout(this.timer)
    this.pc.close()
  }

  private async answer(sdp: RTCSessionDescriptionInit) {
    await this.addRemote(sdp)
    await this.sendDescription('answer')
  }

  private receive(dc: RTCDataChannel) {
    const file = new FileAssembler()
    let complete = false
    dc.binaryType = 'arraybuffer'
    dc.onmessage = (e) => {
      if (complete) return
      const taken = file.take(e.data)
      if (taken === 'invalid') return this.abort()
      if (!taken) return
      complete = true
      // Only say it's stored once it is; otherwise the sender falls back to Storage.
      this.link.onFile(taken.messageId, taken.bytes).then(() => {
        dc.send(STORED)
        setTimeout(() => this.abort(), 1_000)
      }, () => this.abort())
    }
  }
}

export class DirectLink {
  private readonly link: Link

  constructor(options: LinkOptions) {
    this.link = { ...options, sessions: new Map(), signalQuietly: (s) => void options.sendSignal(s).catch(() => {}) }
  }

  /** Resolves once the other phone has stored the bytes. */
  async sendFile(to: string, messageId: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    return new OutgoingTransfer(this.link, to, messageId, bytes).done
  }

  /** Handles a decrypted signalling message from the other phone. */
  handleSignal(s: Signal) {
    const { sessions, selfId, acceptFrom } = this.link
    if (s.to !== selfId || !acceptFrom(s.from)) return
    if (s.type === 'offer') {
      const canTake = typeof RTCPeerConnection !== 'undefined' && !sessions.has(s.session) && sessions.size < MAX_INCOMING
      if (canTake) new IncomingTransfer(this.link, s)
      return
    }
    const transfer = sessions.get(s.session)
    if (s.type === 'answer') transfer?.acceptAnswer(s.sdp)
    else if (s.type === 'ice') transfer?.addIce(s.candidate)
    else if (s.type === 'bye') transfer?.abort()
  }

  close() {
    for (const transfer of this.link.sessions.values()) transfer.abort()
  }
}
