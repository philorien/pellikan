// Imported books: importing a file, listing what is imported, removing it.
//
// The text is extracted here in the web view (shared/doc-import.ts, in a Worker) and stored in user.db through the
// named statements in data/queries/user/. Rust and the dev server run those statements and know nothing about file
// formats, so adding EPUB, DOCX or PDF later means a new extractor, not new storage.
//
// An import is: document row ('processing'), chunks with their references in batches, then 'ready'. If anything fails
// the document is removed again, so a half-imported book never shows up in the library or in a reference lookup.

import { extractDocument, formatOf, MAX_IMPORT_BYTES } from '../../shared/doc-import.ts'
import type { ImportedDocument, ImportFormat } from '../../shared/doc-import.ts'

export interface DocumentRow {
  id: number
  title: string
  author: string | null
  format: string
  original_name: string
  status: 'pending' | 'processing' | 'ready' | 'failed'
  error: string | null
  extracted_chars: number | null
  at: number
  chunks: number
  refs: number
}

/** Chunks per call to user.db. Each call carries the batch as one JSON value (see data/queries/user/doc_chunks_add.sql). */
export const IMPORT_BATCH = 150

/** SHA-256 of the file's bytes as hex. The same file imported twice is recognized by it. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('This web view cannot compute a file checksum, so the file cannot be imported.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * How long to wait for the Worker before giving up on it. Extraction runs at several MB a second (a 1.8 MB text takes
 * well under a second), so a Worker that has not answered after this long is stuck, not slow.
 */
export const EXTRACT_TIMEOUT_MS = 30_000

/**
 * Extracts in a Worker. If no Worker can be started, if it fails to load or crashes, or if it never answers, extracts on
 * this thread instead, so a Worker problem costs a brief freeze and not the ability to import (or a picker that stays
 * disabled for the rest of the session).
 */
export function extractOffThread(text: string, format: ImportFormat, name: string, timeoutMs = EXTRACT_TIMEOUT_MS): Promise<ImportedDocument> {
  const inline = () => {
    try { return Promise.resolve(extractDocument(text, format, name)) } catch (err) { return Promise.reject(err) }
  }
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/extract.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      inline().then(resolve, reject)
      return
    }
    let settled = false
    const fallBack = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      inline().then(resolve, reject)
    }
    const timer = setTimeout(fallBack, timeoutMs)
    worker.onmessage = (e: MessageEvent<{ ok: true; doc: ImportedDocument } | { ok: false; error: string }>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      if (e.data.ok) resolve(e.data.doc)
      else reject(new Error(e.data.error))
    }
    worker.onerror = fallBack
    worker.postMessage({ text, format, name })
  })
}

/** Whether the first load of this app session has cleared imports that were interrupted by the app closing. */
let staleCleared = false

export function useDocuments() {
  const documents = useState<DocumentRow[]>('documents', () => [])
  const loaded = useState('documents-loaded', () => false)
  /** Set while an import runs: what it is doing and how far along it is (0 to 1). */
  const importing = useState<{ name: string; step: string; progress: number } | null>('documents-importing', () => null)
  const error = useState<string | null>('documents-error', () => null)
  const notice = useState<string | null>('documents-notice', () => null)

  async function refresh() {
    documents.value = await userQuery<DocumentRow>('documents_all')
  }

  /** Loads the list. The first call of an app session also marks imports left unfinished by the last session as failed. */
  async function load() {
    try {
      if (!staleCleared) {
        staleCleared = true
        await userQuery('documents_fail_stale')
      }
      await refresh()
      loaded.value = true
    } catch (err) {
      error.value = `Your imported books could not be loaded: ${errorMessage(err)}`
    }
  }

  /** Imports one file. Resolves when it is stored or has failed; failures set `error` and leave nothing behind. */
  async function importFile(file: File): Promise<boolean> {
    if (importing.value) return false
    error.value = null
    notice.value = null
    const fail = (message: string) => {
      error.value = message
      return false
    }

    const format = formatOf(file.name)
    if (!format) return fail(`${file.name}: Pellikan imports .txt and .md files so far. EPUB, DOCX and PDF are planned.`)
    if (file.size > MAX_IMPORT_BYTES) return fail(`${file.name} is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB, which is too big for a text file. Is it the right one?`)

    importing.value = { name: file.name, step: 'Reading the file', progress: 0 }
    let id: number | null = null
    try {
      const bytes = await file.arrayBuffer()
      const sha256 = await sha256Hex(bytes)

      const [existing] = await userQuery<{ id: number; title: string; status: string }>('document_by_hash', { sha256 })
      if (existing) {
        if (existing.status === 'ready') return fail(`“${existing.title}” is already in your library.`)
        await userQuery('document_remove', { id: existing.id }) // an earlier attempt that did not finish: start over
      }

      importing.value = { name: file.name, step: 'Finding Scripture references', progress: 0.05 }
      const doc = await extractOffThread(new TextDecoder('utf-8').decode(bytes), format, file.name)

      const [row] = await userQuery<{ id: number }>('document_add', { title: doc.title, author: doc.author, format, original_name: file.name, sha256 })
      id = row!.id

      for (let i = 0; i < doc.chunks.length; i += IMPORT_BATCH) {
        importing.value = { name: file.name, step: 'Saving', progress: 0.1 + 0.88 * (i / doc.chunks.length) }
        const chunks = JSON.stringify(doc.chunks.slice(i, i + IMPORT_BATCH))
        await userBatch([
          { name: 'doc_chunks_add', params: { document: id, chunks } },
          { name: 'doc_refs_add', params: { document: id, chunks } },
        ])
      }
      await userQuery('document_finish', { id, chars: doc.chars })
      await refresh()
      const refs = doc.chunks.reduce((n, c) => n + c.refs.length, 0)
      notice.value = `Imported “${doc.title}”: ${doc.chunks.length} passages, ${refs} Scripture references.`
      return true
    } catch (err) {
      if (id !== null) {
        // Never leave a half-imported book behind. If even this fails, the next start marks it failed.
        try { await userQuery('document_remove', { id }) } catch { /* see above */ }
      }
      try { await refresh() } catch { /* the list is stale, the error below is the news */ }
      return fail(`${file.name} could not be imported: ${errorMessage(err)}`)
    } finally {
      importing.value = null
    }
  }

  async function remove(id: number) {
    error.value = null
    notice.value = null
    const title = documents.value.find((d) => d.id === id)?.title
    try {
      await userQuery('document_remove', { id })
      await refresh()
      // Said in the live region, so that a screen reader user hears that it happened.
      notice.value = title ? `Removed “${title}”.` : 'Removed.'
    } catch (err) {
      error.value = `That book could not be removed: ${errorMessage(err)}`
    }
  }

  return { documents, loaded, importing, error, notice, load, importFile, remove }
}
