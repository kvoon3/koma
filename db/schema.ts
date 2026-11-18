import { sql } from 'void/db'
import { index, integer, sqliteTable, text } from 'void/schema-d1'

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

/**
 * One uploaded library asset. The row is metadata; the bytes sit in R2 at
 * `storage_path`, which the server derives from the signed-in user and the
 * asset id (`src/lib/assetKeys.ts`). `meta` is the serialized
 * `SessionPhotoRecord` minus its file bytes; a Live Photo's still also names
 * its motion asset there (`motionAssetId`), which is a second row. `id` is the
 * client's photo id so a saved cloud document's pane, sticker and cutout
 * references resolve to the served URL without rewriting the document.
 */
export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  /** `photo`, `sticker`, or `music`; validated in the upload handler. */
  kind: text('kind').notNull(),
  storagePath: text('storage_path').notNull(),
  name: text('name').notNull(),
  trueW: integer('true_w').notNull(),
  trueH: integer('true_h').notNull(),
  meta: text('meta'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, table => [
  index('assets_user_id_idx').on(table.userId),
])
