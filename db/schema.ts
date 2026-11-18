import { sql } from 'void/db'
import { index, sqliteTable, text } from 'void/schema-d1'

/**
 * One saved session. `document` is a serialized `CloudDocument` (see
 * `src/lib/cloudSession.ts`): the board, its groups and the visual settings,
 * with asset ids in place of photo bytes. Better Auth's tables are generated
 * from the auth config, never declared here.
 */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  document: text('document').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, table => [
  index('projects_user_id_idx').on(table.userId),
])
