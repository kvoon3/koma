import { projects } from '@schema'
import { defineHandler } from 'void'
import { requireAuth } from 'void/auth'
import { and, db, eq, sql } from 'void/db'
import { NEXT_UPDATED_AT_SQL } from '../../../src/lib/cloudLock'
import { parseJsonBody, parseUpdateBody, writeBodyFailure } from './_body'

/**
 * This user's project, or a 404. The id is another user's too: scoping on
 * `user_id` makes both answers identical, so an id never proves it exists.
 */
export const GET = defineHandler(async (c) => {
  const user = requireAuth(c)
  const id = c.req.param('id')
  if (!id)
    return c.json({ error: 'invalid-id' }, 400)
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
    .limit(1)
  if (!project)
    return c.json({ error: 'not-found' }, 404)
  return project
})

/**
 * Overwrite a session the client loaded at `updatedAt`. The comparison is in
 * the update's own WHERE, so a write that lands between the read and the
 * update cannot slip through: no matching row means either someone else moved
 * it (409) or it was never this user's (404).
 */
export const PUT = defineHandler(async (c) => {
  const user = requireAuth(c)
  const json = parseJsonBody(await c.req.text())
  if (!json.ok)
    return c.json({ error: 'invalid-body' }, 400)
  const body = parseUpdateBody(json.value)
  if (!body.ok) {
    const failure = writeBodyFailure(body.error)
    return c.json(failure.body, failure.status)
  }
  const id = c.req.param('id')
  if (!id)
    return c.json({ error: 'invalid-id' }, 400)
  const scope = and(eq(projects.id, id), eq(projects.userId, user.id))
  const [updated] = await db
    .update(projects)
    .set({
      ...(body.value.name === undefined ? {} : { name: body.value.name }),
      document: body.value.document,
      updatedAt: sql.raw(NEXT_UPDATED_AT_SQL),
    })
    .where(and(scope, eq(projects.updatedAt, body.value.updatedAt)))
    .returning({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
  if (updated)
    return updated
  const [current] = await db
    .select({ updatedAt: projects.updatedAt })
    .from(projects)
    .where(scope)
    .limit(1)
  return current
    ? c.json({ error: 'conflict', updatedAt: current.updatedAt }, 409)
    : c.json({ error: 'not-found' }, 404)
})

export const DELETE = defineHandler(async (c) => {
  const user = requireAuth(c)
  const id = c.req.param('id')
  if (!id)
    return c.json({ error: 'invalid-id' }, 400)
  const [removed] = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
    .returning({ id: projects.id })
  if (!removed)
    return c.json({ error: 'not-found' }, 404)
  return removed
})
