import type { H3Event } from 'h3'

/**
 * The user routes write to a database, so they only accept a JSON content type. A page on another origin cannot
 * send that without a CORS preflight, which this server does not answer, so a stray site open in the same browser
 * cannot add or delete notes while `npm run dev` is running.
 */
export function assertJsonRequest(event: H3Event) {
  if (!(getHeader(event, 'content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw createError({ statusCode: 415, statusMessage: 'Send JSON' })
  }
}
