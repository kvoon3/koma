/// <reference types="bun" />
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { NEXT_UPDATED_AT_SQL } from './cloudLock'

const UPDATE = `UPDATE projects SET updated_at = ${NEXT_UPDATED_AT_SQL} WHERE id = 'p1' AND updated_at = ?`
const READ = 'SELECT updated_at FROM projects WHERE id = ?'

function create() {
  const db = new Database(':memory:')
  db.run('CREATE TABLE projects (id text PRIMARY KEY NOT NULL, updated_at text NOT NULL DEFAULT (datetime(\'now\')))')
  db.run('INSERT INTO projects (id) VALUES (?)', ['p1'])
  return db
}

function token(db: Database): string {
  const row = db.query<{ updated_at: string }, [string]>(READ).get('p1')
  if (!row)
    throw new Error('projects row missing')
  return row.updated_at
}

describe('NEXT_UPDATED_AT_SQL', () => {
  test('a write advances the token and refuses every earlier base', () => {
    const db = create()
    let base = token(db)
    for (let i = 0; i < 25; i++) {
      expect(db.run(UPDATE, [base]).changes).toBe(1)
      const next = token(db)
      expect(next > base).toBe(true)
      expect(db.run(UPDATE, [base]).changes).toBe(0)
      base = next
    }
  })

  test('the first write turns a second-resolution insert into a millisecond token', () => {
    const db = create()
    const base = token(db)
    expect(base).not.toMatch(/\.\d{3}$/)
    db.run(UPDATE, [base])
    expect(token(db)).toMatch(/\.\d{3}$/)
  })
})
