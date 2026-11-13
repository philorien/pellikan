import { runUserBatch } from '../../utils/userDb'

export default defineEventHandler(async (event) => {
  assertJsonRequest(event)
  runUserBatch((await readBody(event))?.ops)
  return { ok: true }
})
