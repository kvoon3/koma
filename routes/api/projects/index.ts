import { projects } from '@schema'
import { defineHandler } from 'void'
import { requireAuth } from 'void/auth'
import { db, desc, eq } from 'void/db'
import { parseCreateBody, parseJsonBody, writeBodyFailure } from './_body'

/** The signed-in user's saved sessions, newest first. The bodies stay on the server. */
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c)
  return await db
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(projects.updatedAt))
})

/** Save a new session. The id is generated here, never accepted from the client. */
export const POST = defineHandler(async (c) => {
  const user = requireAuth(c)
  const json = parseJsonBody(await c.req.text())
  if (!json.ok)
    return c.json({ error: 'invalid-body' }, 400)
  const body = parseCreateBody(json.value)
  if (!body.ok) {
    const failure = writeBodyFailure(body.error)
    return c.json(failure.body, failure.status)
  }
  const [created] = await db
    .insert(projects)
    .values({
      id: crypto.randomUUID(),
      userId: user.id,
      name: body.value.name,
      document: body.value.document,
    })
    .returning({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
  return created
})
