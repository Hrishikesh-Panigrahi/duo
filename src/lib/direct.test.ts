import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHUNK_BYTES, DirectLink, FileAssembler, joinChunks, parseHeader, type Signal } from './direct'

const id = '3f2b8c1e-9a4d-4e7f-8b2a-1c5d6e7f8a9b'

describe('direct transfer framing', () => {
  it('accepts a header naming a message and a sensible size', () => {
    expect(parseHeader(JSON.stringify({ messageId: id, size: 36556 }))).toEqual({ messageId: id, size: 36556 })
  })

  it('refuses anything else as a header', () => {
    expect(parseHeader(new ArrayBuffer(8))).toBeNull()
    expect(parseHeader('not json')).toBeNull()
    expect(parseHeader(JSON.stringify({ messageId: '../../etc', size: 10 }))).toBeNull()
    expect(parseHeader(JSON.stringify({ messageId: id, size: 0 }))).toBeNull()
    expect(parseHeader(JSON.stringify({ messageId: id, size: 1.5 }))).toBeNull()
    expect(parseHeader(JSON.stringify({ messageId: id, size: 60 * 1024 * 1024 }))).toBeNull()
  })

  it('puts chunks back together byte for byte', () => {
    const original = new Uint8Array(CHUNK_BYTES * 3 + 123).map((_, i) => (i * 7) % 256)
    const parts: ArrayBuffer[] = []
    for (let at = 0; at < original.length; at += CHUNK_BYTES) parts.push(original.slice(at, at + CHUNK_BYTES).buffer)
    expect(parts).toHaveLength(4)
    expect(new Uint8Array(joinChunks(parts, original.length))).toEqual(original)
  })

  it('rebuilds a file from a header and exactly its bytes', () => {
    const assembler = new FileAssembler()
    expect(assembler.addMessage(JSON.stringify({ messageId: id, size: 5 }))).toBeNull()
    expect(assembler.addMessage(new Uint8Array([1, 2, 3]).buffer)).toBeNull()
    const done = assembler.addMessage(new Uint8Array([4, 5]).buffer)
    expect(done).toMatchObject({ messageId: id })
    expect(new Uint8Array((done as { bytes: ArrayBuffer }).bytes)).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  it('refuses a bad header, text instead of bytes, and more bytes than promised', () => {
    expect(new FileAssembler().addMessage('not json')).toBe('invalid')
    const text = new FileAssembler()
    text.addMessage(JSON.stringify({ messageId: id, size: 5 }))
    expect(text.addMessage('hello')).toBe('invalid')
    const over = new FileAssembler()
    over.addMessage(JSON.stringify({ messageId: id, size: 2 }))
    expect(over.addMessage(new Uint8Array([1, 2, 3]).buffer)).toBe('invalid')
  })
})

// Node has no WebRTC: just enough of a peer connection to send an offer, or to answer one.
class FakePeerConnection {
  localDescription: { toJSON: () => RTCSessionDescriptionInit } | null = null
  createDataChannel() {
    return { close() {}, send() {} }
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'fake' }
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'fake' }
  }
  async setRemoteDescription() {}
  async addIceCandidate() {}
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = { toJSON: () => description }
  }
  close() {}
}

describe('ending a direct transfer early', () => {
  beforeEach(() => vi.stubGlobal('RTCPeerConnection', FakePeerConnection))
  afterEach(() => vi.unstubAllGlobals())

  function startSending() {
    const signals: Signal[] = []
    const link = new DirectLink({
      selfId: 'me',
      sendSignal: async (signal) => {
        signals.push(signal)
      },
      acceptFrom: (userId) => userId === 'you',
      onFile: async () => {},
    })
    const sent = link.sendFile('you', id, new Uint8Array(8))
    return { link, sent, signals }
  }

  it('says this phone closed the connection when this phone closes it, and tells the other phone', async () => {
    const { link, sent, signals } = startSending()
    link.close()
    await expect(sent).rejects.toThrow('This phone closed the direct connection')
    expect(signals.map((signal) => signal.type)).toContain('bye')
  })

  it('says the other phone stopped the transfer when it sends goodbye', async () => {
    const { link, sent, signals } = startSending()
    await vi.waitFor(() => expect(signals.some((signal) => signal.type === 'offer')).toBe(true))
    link.handleSignal({ session: signals[0].session, from: 'you', to: 'me', type: 'bye' })
    await expect(sent).rejects.toThrow('The other phone stopped the transfer')
  })
})

describe('which transfers this phone takes', () => {
  beforeEach(() => vi.stubGlobal('RTCPeerConnection', FakePeerConnection))
  afterEach(() => vi.unstubAllGlobals())

  function linkWithOutbox() {
    const signals: Signal[] = []
    const link = new DirectLink({
      selfId: 'me',
      sendSignal: async (signal) => {
        signals.push(signal)
      },
      acceptFrom: (userId) => userId === 'you',
      onFile: async () => {},
    })
    const answersSent = () => signals.filter((signal) => signal.type === 'answer').length
    return { link, answersSent }
  }

  const offer = (session: string, from = 'you', to = 'me') =>
    ({ type: 'offer', session, from, to, sdp: { type: 'offer', sdp: 'fake' } }) as const
  // Long enough for an accepted offer to have been answered.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('answers only an offer addressed to this phone from the other member', async () => {
    const { link, answersSent } = linkWithOutbox()
    link.handleSignal(offer('s1', 'you', 'someone-else'))
    link.handleSignal(offer('s2', 'stranger', 'me'))
    await settle()
    expect(answersSent()).toBe(0)
    link.handleSignal(offer('s3'))
    await vi.waitFor(() => expect(answersSent()).toBe(1))
    link.close()
  })

  it('takes at most four transfers at once', async () => {
    const { link, answersSent } = linkWithOutbox()
    for (const session of ['s1', 's2', 's3', 's4', 's5']) link.handleSignal(offer(session))
    await settle()
    expect(answersSent()).toBe(4)
    link.close()
  })

  it('counts the transfers it is sending towards those four', async () => {
    const { link, answersSent } = linkWithOutbox()
    const sending = [1, 2, 3, 4].map(() => link.sendFile('you', id, new Uint8Array(8)).catch(() => {}))
    link.handleSignal(offer('s1'))
    await settle()
    expect(answersSent()).toBe(0)
    link.close()
    await Promise.all(sending)
  })
})
