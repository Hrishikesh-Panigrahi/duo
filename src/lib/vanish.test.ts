import { describe, expect, it } from 'vitest'
import { ChatVisit, vanishingToMarkSeen } from './vanish'
import type { Message } from './types'

const SEEN = '2026-10-19T10:00:00Z'

function message(id: string, fields: Partial<Message> = {}): Message {
  return {
    id,
    space_id: 's',
    sender_id: 'you',
    created_at: `2026-10-19T09:00:0${id.length % 10}Z`,
    body: id,
    contact: null,
    media: null,
    has_media: false,
    media_opened_at: null,
    media_direct: false,
    vanishing: true,
    seen_at: null,
    ...fields,
  }
}

const ids = (messages: Message[]) => messages.map((m) => m.id)

describe('a visit to the chat in vanish mode', () => {
  it('shows a vanishing message seen during this visit, but not on the next one', () => {
    const visit = new ChatVisit()
    expect(ids(visit.visible([message('hello')]))).toEqual(['hello'])
    expect(ids(visit.visible([message('hello', { seen_at: SEEN })]))).toEqual(['hello'])
    expect(ids(new ChatVisit().visible([message('hello', { seen_at: SEEN })]))).toEqual([])
  })

  it('keeps a seen message on screen until you leave, even once it has been deleted', () => {
    const visit = new ChatVisit()
    visit.visible([message('hello')])
    visit.visible([message('hello', { seen_at: SEEN })])
    expect(ids(visit.visible([]))).toEqual(['hello'])
    expect(ids(new ChatVisit().visible([]))).toEqual([])
  })

  it("lets go of an unseen message its sender deleted, and never hides ordinary messages", () => {
    const visit = new ChatVisit()
    visit.visible([message('unseen'), message('kept', { vanishing: false, seen_at: SEEN })])
    expect(ids(visit.visible([message('kept', { vanishing: false, seen_at: SEEN })]))).toEqual(['kept'])
  })

  it('keeps a message this device just read, even if it is deleted before the server says it was seen', () => {
    const visit = new ChatVisit()
    visit.visible([message('hello')])
    expect(visit.takeNewlySeen(['hello'])).toEqual(['hello'])
    expect(visit.takeNewlySeen(['hello'])).toEqual([])
    expect(ids(visit.visible([]))).toEqual(['hello'])
  })

  it('lets go at once of a message you delete yourself', () => {
    const visit = new ChatVisit()
    visit.visible([message('mine', { sender_id: 'me' })])
    visit.visible([message('mine', { sender_id: 'me', seen_at: SEEN })])
    visit.letGo('mine')
    expect(ids(visit.visible([]))).toEqual([])
  })

  it('counts a photo as seen only once it has been opened', () => {
    const notOpened = message('photo', { has_media: true, seen_at: SEEN })
    expect(ids(new ChatVisit().visible([notOpened]))).toEqual(['photo'])
    expect(ids(new ChatVisit().visible([{ ...notOpened, media_opened_at: SEEN }]))).toEqual([])
  })
})

describe('which messages to mark seen', () => {
  it("marks only their unseen, readable vanishing messages, and leaves photos to opening", () => {
    const onScreen = [
      message('theirs'),
      message('mine', { sender_id: 'me' }),
      message('already', { seen_at: SEEN }),
      message('ordinary', { vanishing: false }),
      message('locked', { locked: true }),
      message('photo', { has_media: true }),
    ]
    expect(vanishingToMarkSeen(onScreen, 'me')).toEqual(['theirs'])
  })
})
