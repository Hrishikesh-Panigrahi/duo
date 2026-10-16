// Loads a space's rows and keeps them live over Realtime row changes. Everything here is ciphertext.
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { errorMessage } from '../../components/ui'
import { must, supabase } from '../supabase'
import type { StoredContact, StoredItem, StoredList, StoredMember, StoredMessage, StoredNote, StoredSpace } from '../types'
import { MESSAGE_LIMIT, TABLES, oldestFirst, type AnyRow, type Rows, type Table } from './rows'

export type RowChange = { type: 'upsert'; table: Table; row: AnyRow } | { type: 'remove'; table: Table; id: string }

export type SyncOptions = {
  spaceId: string
  userId: string
  onRows: (rows: Rows) => void
  onSpace: (space: StoredSpace) => void
  onMembers: (members: StoredMember[]) => void
  onChange: (change: RowChange) => void
  /** Your person's message just arrived (so they've stopped typing). */
  onPartnerMessage: () => void
  onError: (message: string) => void
}

export class SpaceSync {
  private alive = true
  private readonly changesChannel: RealtimeChannel

  constructor(private readonly options: SyncOptions) {
    // A unique name: supabase.channel(name) hands back any channel with that name, even one a previous
    // mount is still tearing down, and reusing that one goes silently dead.
    const uniqueSuffix = Math.random().toString(36).slice(2)
    this.changesChannel = supabase.channel(`changes:${options.spaceId}:${uniqueSuffix}`)
    for (const table of TABLES) {
      // Unfiltered: Realtime can't filter DELETEs, and RLS already limits the rest to our space.
      this.changesChannel.on('postgres_changes', { event: '*', schema: 'public', table }, (change) => this.applyChange(table, change))
    }
    for (const table of ['spaces', 'members']) {
      this.changesChannel.on('postgres_changes', { event: '*', schema: 'public', table }, () => void this.loadSpaceAndMembers().catch(() => {}))
    }
    this.changesChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') void this.reload() // catches anything that changed while (re)connecting
    })
    void this.reload()
  }

  /** Fetches everything again (the app came back to the foreground). */
  async reload() {
    try {
      const [rows] = await Promise.all([this.loadRows(), this.loadSpaceAndMembers()])
      if (this.alive) this.options.onRows(rows)
    } catch (e) {
      if (import.meta.env.DEV) console.error('Loading space failed', e)
      if (this.alive) this.options.onError(errorMessage(e))
    }
  }

  close() {
    this.alive = false
    void supabase.removeChannel(this.changesChannel)
  }

  private async loadRows(): Promise<Rows> {
    const inSpace = (t: Table) => supabase.from(t).select('*').eq('space_id', this.options.spaceId)
    const [contacts, messages, notes, lists, list_items] = await Promise.all([
      must<StoredContact[]>(inSpace('contacts')),
      must<StoredMessage[]>(inSpace('messages').order('created_at', { ascending: false }).limit(MESSAGE_LIMIT)),
      must<StoredNote[]>(inSpace('notes')),
      must<StoredList[]>(inSpace('lists')),
      must<StoredItem[]>(inSpace('list_items')),
    ])
    return {
      contacts: oldestFirst(contacts),
      messages: oldestFirst(messages),
      notes: oldestFirst(notes),
      lists: oldestFirst(lists),
      list_items: oldestFirst(list_items),
    }
  }

  private async loadSpaceAndMembers() {
    const [space, members] = await Promise.all([
      must<StoredSpace>(supabase.from('spaces').select('*').eq('id', this.options.spaceId).single()),
      must<StoredMember[]>(supabase.from('members').select('*').eq('space_id', this.options.spaceId).order('joined_at')),
    ])
    if (!this.alive) return
    this.options.onSpace(space)
    this.options.onMembers(members)
  }

  private applyChange(table: Table, change: RealtimePostgresChangesPayload<Record<string, unknown>>) {
    if (change.eventType === 'DELETE') {
      // A DELETE carries only the id; removing one we don't have is a no-op.
      const id = (change.old as Partial<AnyRow>).id
      if (id) this.options.onChange({ type: 'remove', table, id })
      return
    }
    const row = change.new as AnyRow & { space_id: string; sender_id?: string }
    if (row.space_id !== this.options.spaceId) return
    this.options.onChange({ type: 'upsert', table, row })
    if (table === 'messages' && change.eventType === 'INSERT' && row.sender_id !== this.options.userId) this.options.onPartnerMessage()
  }
}

// Realtime channels don't survive hot-swapping this module, so in dev an edit here reloads the page.
import.meta.hot?.dispose(() => location.reload())
