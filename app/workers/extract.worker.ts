// Runs extractDocument off the main thread, so that reading a long book does not freeze the window. Used by
// useDocuments.ts. No state: one message in (the decoded text), one message out.
import { extractDocument } from '../../shared/doc-import.ts'
import type { ImportFormat } from '../../shared/doc-import.ts'

self.onmessage = (event: MessageEvent<{ text: string; format: ImportFormat; name: string }>) => {
  const { text, format, name } = event.data
  try {
    self.postMessage({ ok: true, doc: extractDocument(text, format, name) })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
