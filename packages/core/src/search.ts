/**
 * Web Search domain: a provider normalizes a vendor response into Aisling's own
 * `SearchResult` objects, so the raw vendor JSON never reaches the character.
 */

export interface SearchResult {
  readonly title: string
  readonly url: string
  readonly snippet: string
  /** Which provider produced this result (kept for future citations/trust). */
  readonly source: string
}

export interface WebSearchProvider {
  readonly id: string
  search(query: string): Promise<SearchResult[]>
}
