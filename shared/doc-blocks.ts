// What every extractor (text, Markdown, EPUB, DOCX, PDF) hands to the chunker: a title, an author, and the book as a
// flat list of headings and paragraphs, in reading order. Keep this file free of enums and parameter properties: Node
// imports it directly as well as the Nuxt build.

export type Block =
  | { kind: 'heading'; text: string; level: number; page?: number }
  | { kind: 'para'; text: string; page?: number }

export interface ExtractedBlocks {
  title: string | null
  author: string | null
  blocks: Block[]
}

/** A message for the user, thrown by an extractor when it cannot read the file. */
export class ImportError extends Error {}
