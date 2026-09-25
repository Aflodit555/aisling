/**
 * Web Search domain: a provider extracts the Lite page's titles and snippets
 * into Aisling-owned results before the character sees them.
 */

export interface SearchResult {
  readonly title: string
  readonly snippet: string
}

export interface WebSearchProvider {
  readonly id: string
  search(query: string): Promise<SearchResult[]>
}
