// Sends already-encrypted files phone to phone over WebRTC; if that fails, the caller uses Storage.
// Only STUN, deliberately no TURN relay: a file goes phone to phone or not at all.

export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]
/** Safe for every browser's data channel message size. */
export const CHUNK_BYTES = 16 * 1024
const CONNECT_TIMEOUT_MS = 8_000
const TRANSFER_TIMEOUT_MS = 120_000
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_INCOMING = 4
/** The sender waits for the send buffer to drain below this before queueing more chunks. */
const SEND_BUFFER_LOW_BYTES = 1024 * 1024
/** The receiver's one reply: the file is safely stored. */
const STORED_REPLY = 'stored'
// Why an outgoing transfer ended early. Whoever stops it passes the reason, so it's never a guess.
const COULD_NOT_CONNECT = "Couldn't connect directly"
const OTHER_PHONE_STOPPED = 'The other phone stopped the transfer'
const THIS_PHONE_CLOSED = 'This phone closed the direct connection'

type Route = { session: string; from: string; to: string }
type Offer = Route & { type: 'offer'; sdp: RTCSessionDescriptionInit }
export type Signal =
  | Offer
  | (Route & { type: 'answer'; sdp: RTCSessionDescriptionInit })
  | (Route & { type: 'ice'; candidate: RTCIceCandidateInit })
  | (Route & { type: 'bye' })

export type FileHeader = { messageId: string; size: number }

export type LinkOptions = {
  selfId: string
  sendSignal: (signal: Signal) => Promise<void>
  /** Only the other member of the space may send us files. */
  acceptFrom: (userId: string) => boolean
  /** Receives the still-encrypted bytes; must have stored them when it resolves. */
  onFile: (messageId: string, bytes: ArrayBuffer) => Promise<void>
}

type TransferContext = LinkOptions & { transfersBySession: Map<string, Transfer>; signalQuietly: (signal: Signal) => void }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The first data channel message names the file and its size; anything else is refused. */
export function parseHeader(data: unknown): FileHeader | null {
  if (typeof data !== 'string') return null
  try {
    const header = JSON.parse(data) as Partial<FileHeader>
    if (typeof header.messageId !== 'string' || !UUID.test(header.messageId)) return null
    if (typeof header.size !== 'number' || !Number.isInteger(header.size) || header.size <= 0 || header.size > MAX_FILE_BYTES) return null
    return { messageId: header.messageId, size: header.size }
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
  private header: FileHeader | null = null
  private parts: ArrayBuffer[] = []
  private received = 0

  /** The finished file, 'invalid' for anything unexpected, or null while there's more to come. */
  addMessage(data: unknown): { messageId: string; bytes: ArrayBuffer } | 'invalid' | null {
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
  readonly peer = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  private pendingIce: RTCIceCandidateInit[] = []
  private remoteDescriptionSet = false
  private answered = false
  private ended = false

  constructor(
    protected readonly context: TransferContext,
    protected readonly route: Route,
  ) {
    context.transfersBySession.set(route.session, this)
    this.peer.onicecandidate = (e) => {
      if (e.candidate) context.signalQuietly({ ...route, type: 'ice', candidate: e.candidate.toJSON() })
    }
  }

  /** Ends the transfer now. An unfinished outgoing one rejects with `reason`; an incoming one just closes. */
  abstract stop(reason: string): void

  acceptAnswer(sdp: RTCSessionDescriptionInit) {
    // If they're signed in on two devices, both answer; the first one wins.
    if (this.answered) return
    this.answered = true
    this.addRemote(sdp).catch(() => this.stop(COULD_NOT_CONNECT))
  }

  addIce(candidate: RTCIceCandidateInit) {
    if (this.remoteDescriptionSet) void this.peer.addIceCandidate(candidate).catch(() => {})
    else this.pendingIce.push(candidate)
  }

  protected async addRemote(sdp: RTCSessionDescriptionInit) {
    await this.peer.setRemoteDescription(sdp)
    this.remoteDescriptionSet = true
    for (const candidate of this.pendingIce.splice(0)) await this.peer.addIceCandidate(candidate).catch(() => {})
  }

  protected async sendDescription(type: 'offer' | 'answer') {
    await this.peer.setLocalDescription(type === 'offer' ? await this.peer.createOffer() : await this.peer.createAnswer())
    await this.context.sendSignal({ ...this.route, type, sdp: this.peer.localDescription!.toJSON() })
  }

  /** True only on the first call. */
  protected markEnded(): boolean {
    if (this.ended) return false
    this.ended = true
    this.context.transfersBySession.delete(this.route.session)
    return true
  }
}

class OutgoingTransfer extends Transfer {
  readonly done: Promise<void>
  private readonly channel: RTCDataChannel
  private settle: (err?: Error) => void = () => {}
  private readonly connectTimer = setTimeout(() => this.finish(new Error(COULD_NOT_CONNECT)), CONNECT_TIMEOUT_MS)
  private readonly transferTimer = setTimeout(() => this.finish(new Error('Direct transfer took too long')), TRANSFER_TIMEOUT_MS)

  constructor(context: TransferContext, to: string, messageId: string, bytes: Uint8Array<ArrayBuffer>) {
    super(context, { session: crypto.randomUUID(), from: context.selfId, to })
    this.done = new Promise((resolve, reject) => {
      this.settle = (err) => {
        if (err) reject(err)
        else resolve()
      }
    })
    this.channel = this.peer.createDataChannel('media', { ordered: true })
    this.channel.binaryType = 'arraybuffer'
    this.channel.bufferedAmountLowThreshold = SEND_BUFFER_LOW_BYTES
    this.channel.onopen = () => void this.sendInChunks(messageId, bytes)
    this.channel.onclose = () => this.finish(new Error('The direct connection closed early'))
    this.channel.onmessage = (e) => {
      if (e.data === STORED_REPLY) this.finish()
    }
    this.peer.onconnectionstatechange = () => {
      if (this.peer.connectionState === 'failed') this.finish(new Error(COULD_NOT_CONNECT))
    }
    this.sendDescription('offer').catch((e: Error) => this.finish(e))
  }

  stop(reason: string) {
    this.finish(new Error(reason))
  }

  private async sendInChunks(messageId: string, bytes: Uint8Array<ArrayBuffer>) {
    clearTimeout(this.connectTimer)
    try {
      this.channel.send(JSON.stringify({ messageId, size: bytes.byteLength } satisfies FileHeader))
      for (let at = 0; at < bytes.byteLength; at += CHUNK_BYTES) {
        if (this.channel.bufferedAmount > this.channel.bufferedAmountLowThreshold) {
          await new Promise((resolve) => this.channel.addEventListener('bufferedamountlow', resolve, { once: true }))
        }
        this.channel.send(bytes.subarray(at, at + CHUNK_BYTES))
      }
    } catch (e) {
      this.finish(e as Error)
    }
  }

  private finish(err?: Error) {
    if (!this.markEnded()) return
    clearTimeout(this.connectTimer)
    clearTimeout(this.transferTimer)
    try {
      this.channel.close()
    } catch {
      // already closed
    }
    this.peer.close()
    if (err) this.context.signalQuietly({ ...this.route, type: 'bye' })
    this.settle(err)
  }
}

class IncomingTransfer extends Transfer {
  private readonly timer = setTimeout(() => this.stop(), TRANSFER_TIMEOUT_MS)

  constructor(context: TransferContext, offer: Offer) {
    super(context, { session: offer.session, from: context.selfId, to: offer.from })
    this.peer.ondatachannel = (e) => this.receive(e.channel)
    this.answer(offer.sdp).catch(() => this.stop())
  }

  stop() {
    if (!this.markEnded()) return
    clearTimeout(this.timer)
    this.peer.close()
  }

  private async answer(sdp: RTCSessionDescriptionInit) {
    await this.addRemote(sdp)
    await this.sendDescription('answer')
  }

  private receive(channel: RTCDataChannel) {
    const assembler = new FileAssembler()
    let complete = false
    channel.binaryType = 'arraybuffer'
    channel.onmessage = (e) => {
      if (complete) return
      const result = assembler.addMessage(e.data)
      if (result === 'invalid') return this.stop()
      if (!result) return
      complete = true
      // Only say it's stored once it is; otherwise the sender falls back to Storage.
      this.context.onFile(result.messageId, result.bytes).then(() => {
        channel.send(STORED_REPLY)
        setTimeout(() => this.stop(), 1_000)
      }, () => this.stop())
    }
  }
}

export class DirectLink {
  private readonly context: TransferContext

  constructor(options: LinkOptions) {
    this.context = { ...options, transfersBySession: new Map(), signalQuietly: (signal) => void options.sendSignal(signal).catch(() => {}) }
  }

  /** Resolves once the other phone has stored the bytes. */
  async sendFile(to: string, messageId: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    return new OutgoingTransfer(this.context, to, messageId, bytes).done
  }

  /** Handles a decrypted signalling message from the other phone. */
  handleSignal(signal: Signal) {
    const { transfersBySession, selfId, acceptFrom } = this.context
    if (signal.to !== selfId || !acceptFrom(signal.from)) return
    if (signal.type === 'offer') {
      const canTake =
        typeof RTCPeerConnection !== 'undefined' && !transfersBySession.has(signal.session) && transfersBySession.size < MAX_INCOMING
      if (canTake) new IncomingTransfer(this.context, signal)
      return
    }
    const transfer = transfersBySession.get(signal.session)
    if (signal.type === 'answer') transfer?.acceptAnswer(signal.sdp)
    else if (signal.type === 'ice') transfer?.addIce(signal.candidate)
    else if (signal.type === 'bye') transfer?.stop(OTHER_PHONE_STOPPED)
  }

  close() {
    for (const transfer of this.context.transfersBySession.values()) transfer.stop(THIS_PHONE_CLOSED)
  }
}
