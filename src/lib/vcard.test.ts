import { describe, expect, it } from 'vitest'
import { parseVCards, toVCard, vcardFileName } from './vcard'

describe('toVCard', () => {
  it('writes a vCard 3.0 that phones accept', () => {
    const v = toVCard({
      full_name: 'Asha Rao',
      phones: ['+91 98765 43210', '  '],
      emails: ['asha@example.com'],
      company: 'Rao; Sons',
      birthday: '1990-03-15',
      notes: 'Line one\nLine two',
    })
    expect(v.split('\r\n')).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Rao;Asha;;;',
      'FN:Asha Rao',
      'ORG:Rao\\; Sons',
      'TEL;TYPE=CELL:+91 98765 43210',
      'EMAIL;TYPE=INTERNET:asha@example.com',
      'BDAY:1990-03-15',
      'NOTE:Line one\\nLine two',
      'END:VCARD',
      '',
    ])
  })

  it('marks birthdays without a year the way iOS does', () => {
    expect(toVCard({ full_name: 'X', phones: [], emails: [], birthday: '1604-07-02' })).toContain(
      'BDAY;X-APPLE-OMIT-YEAR=1604:1604-07-02',
    )
  })

  it('can leave notes out (for QR codes)', () => {
    expect(toVCard({ full_name: 'X', phones: [], emails: [], notes: 'secret' }, { includeNotes: false })).not.toContain(
      'NOTE',
    )
  })

  it('folds long lines without splitting multi-byte characters', () => {
    const v = toVCard({ full_name: 'X', phones: [], emails: [], notes: 'नमस्ते '.repeat(30) })
    for (const line of v.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(parseVCards(v)[0].notes).toBe('नमस्ते '.repeat(30).trim())
  })
})

describe('parseVCards', () => {
  it('round-trips what toVCard writes', () => {
    const card = {
      full_name: 'Mei Chen',
      phones: ['+44 20 7946 0958', '07700 900123'],
      emails: ['mei@example.com'],
      company: 'Acme, Inc.',
      address: '221B Baker St\nLondon',
      birthday: '1604-12-25',
      notes: 'Allergic to peanuts; loves tea',
    }
    expect(parseVCards(toVCard(card))).toEqual([card])
  })

  it('reads several cards, group prefixes, folded lines and vCard 4 birthdays', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'FN:Ravi',
      'item1.TEL;type=CELL;type=pref:+91 90000 ',
      ' 00001',
      'BDAY:--0704',
      'END:VCARD',
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Doe;Jane;;Dr.;',
      'EMAIL;type=INTERNET:mailto:jane@example.com',
      'ADR;TYPE=HOME:;;1 Main St;Springfield;;12345;USA',
      'END:VCARD',
    ].join('\r\n')
    expect(parseVCards(text)).toEqual([
      { full_name: 'Ravi', phones: ['+91 90000 00001'], emails: [], company: null, address: null, birthday: '1604-07-04', notes: null },
      {
        full_name: 'Dr. Jane Doe',
        phones: [],
        emails: ['jane@example.com'],
        company: null,
        address: '1 Main St, Springfield, 12345, USA',
        birthday: null,
        notes: null,
      },
    ])
  })

  it('decodes vCard 2.1 quoted-printable from Android exports', () => {
    const text = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;=E0=A4=AE=E0=A4=BE=E0=A4=81;;;',
      'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E0=A4=AE=E0=A4=BE=',
      '=E0=A4=81',
      'TEL;CELL:+919876543210',
      'END:VCARD',
    ].join('\n')
    expect(parseVCards(text)[0]).toMatchObject({ full_name: 'माँ', phones: ['+919876543210'] })
  })

  it('falls back to a phone number when a card has no name, and skips empty cards', () => {
    const text = 'BEGIN:VCARD\nVERSION:3.0\nTEL:12345\nEND:VCARD\nBEGIN:VCARD\nVERSION:3.0\nEND:VCARD\n'
    expect(parseVCards(text).map((c) => c.full_name)).toEqual(['12345'])
  })
})

describe('vcardFileName', () => {
  it('strips characters that file systems reject', () => {
    expect(vcardFileName('  A/B: "C"  ')).toBe('AB C.vcf')
    expect(vcardFileName('')).toBe('contact.vcf')
  })
})
