import type { H3Event } from 'h3'

/**
 * The user routes write to a database, so they only accept a JSON content type. In a browser, a page on another
 * origin cannot send that without a CORS preflight, which this server does not answer, so an ordinary site open in
 * the same browser cannot add or delete notes while `npm run dev` is running. It does not stop DNS rebinding or other
 * processes on this machine. That is acceptable for a dev-only server that holds test data; do not rely on it for
 * anything that ships.
 */
export function assertJsonRequest(event: H3Event) {
  if (!(getHeader(event, 'content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw createError({ statusCode: 415, statusMessage: 'Send JSON' })
  }
}
