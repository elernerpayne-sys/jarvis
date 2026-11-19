/** What a handbook entry and a decision have in common, as far as the sheet cares. */
export interface MemoryItem {
  id: string
  title: string
  /** Set once the item is synced with Notion. Never edited here. */
  notion_page_id: string | null
}

/** One message per field that needs fixing. No key means the field is fine. */
export type DraftErrors<Draft> = Partial<Record<keyof Draft, string>>

/**
 * What a set of form fields is given. A draft holds the text exactly as
 * typed; it only becomes a service input when the owner saves.
 */
export interface FieldsProps<Draft> {
  draft: Draft
  errors: DraftErrors<Draft>
  onChange: (patch: Partial<Draft>) => void
}
