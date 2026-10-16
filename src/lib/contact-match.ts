// Matching contacts: spotting one that's already in the book, and searching the list.
import type { Contact } from './types'
import type { ContactCard } from './vcard'

/** A contact already in the book with the same name or a shared phone number. */
export function findDuplicate(card: ContactCard, contacts: Contact[]): Contact | undefined {
  const name = card.full_name.trim().toLowerCase()
  // Compare the last ten digits, so +91 98765 43210 and 098765 43210 match. Under seven isn't a real number.
  const cardPhones = new Set<string>()
  for (const phone of card.phones) {
    const lastTen = phone.replace(/\D/g, '').slice(-10)
    if (lastTen.length >= 7) cardPhones.add(lastTen)
  }
  return contacts.find(
    (contact) => contact.full_name.trim().toLowerCase() === name || contact.phones.some((phone) => cardPhones.has(phone.replace(/\D/g, '').slice(-10))),
  )
}

/** The contacts that match the search text and, when one is picked, the tag. */
export function filterContacts(contacts: Contact[], query: string, tag: string | null = null): Contact[] {
  const search = query.trim().toLowerCase()
  const searchDigits = search.replace(/\D/g, '')
  return contacts.filter((contact) => {
    if (tag && !contact.tags.includes(tag)) return false
    if (!search) return true
    // Joined with newlines so a search can't match across the end of one field and the start of the next.
    const searchable = [contact.full_name, contact.company, contact.notes, contact.address, ...contact.emails, ...contact.tags]
      .filter(Boolean)
      .join('\n')
      .toLowerCase()
    if (searchable.includes(search)) return true
    // Phones match on their digits alone, ignoring spaces and dashes; under three digits would match almost everyone.
    return searchDigits.length >= 3 && contact.phones.some((phone) => phone.replace(/\D/g, '').includes(searchDigits))
  })
}
