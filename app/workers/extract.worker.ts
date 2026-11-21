// Runs extractFile off the main thread, so that reading a long book does not freeze the window. Used by
// useDocuments.ts. No state: one message in (the decoded text, or the file's bytes), one message out.
import { extractFile } from '../../shared/doc-import.ts'
import type { ImportFormat } from '../../shared/doc-import.ts'

self.onmessage = async (event: MessageEvent<{ input: string | Uint8Array; format: ImportFormat; name: string }>) => {
  const { input, format, name } = event.data
  try {
    self.postMessage({ ok: true, doc: await extractFile(input, format, name) })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
