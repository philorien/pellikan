import { runUserQuery } from '../../../utils/userDb'

export default defineEventHandler(async (event) => {
  assertJsonRequest(event)
  return runUserQuery(getRouterParam(event, 'name'), await readBody(event))
})
