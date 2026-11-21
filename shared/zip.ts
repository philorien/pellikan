// Reads a few files out of a ZIP (EPUB and DOCX are ZIPs) without trusting it.
//
// A "zip bomb" is a small file that inflates to gigabytes. Here every file that is read has a size limit, and so does
// the sum: the declared size of an entry is checked before it is inflated, and fflate does not write past the size an
// entry declares, so an entry that lies about its size is cut off at the limit and not inflated in full. Entries the
// caller does not ask for (images, fonts) are never inflated at all.

import { unzipSync } from 'fflate'
import { ImportError } from './doc-blocks.ts'

/** Largest single entry read, and the most read in all. Text in a book is a few MB; this is far beyond that. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024
export const MAX_TOTAL_BYTES = 192 * 1024 * 1024

/** True if the bytes begin like a ZIP file ("PK"). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5)
}

/**
 * The entries `wanted` accepts, by name. Names are matched as written in the archive; a name with a leading "/" or a
 * "..", which would only matter if something wrote the files out, is simply not found.
 */
export function readZip(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  let total = 0
  try {
    return unzipSync(bytes, {
      filter(file) {
        if (!wanted(file.name)) return false
        if (file.originalSize > MAX_ENTRY_BYTES) throw new ImportError('This file holds a section far larger than any book, so it was not opened.')
        total += file.originalSize
        if (total > MAX_TOTAL_BYTES) throw new ImportError('This file holds far more text than a book does, so it was not opened.')
        return true
      },
    })
  } catch (err) {
    if (err instanceof ImportError) throw err
    throw new ImportError('The file is damaged: it could not be unpacked.')
  }
}

/** Decodes bytes as UTF-8, tolerating a byte order mark. UTF-16 (which XML allows) is recognised by its mark. */
export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
}
