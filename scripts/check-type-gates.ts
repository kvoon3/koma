import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const probeDir = join(root, '.gate-probe')
const lintProbe = join(root, 'src/__type_gate_probe__.ts')
const tsc = join(root, 'node_modules/.bin/tsc')
const eslint = join(root, 'node_modules/.bin/eslint')

const typeFixture = `
import { Marker } from './marker'

export function marker(): Marker {
  return 'x'
}

export function first(values: string[]): string {
  return values[0].toUpperCase()
}

interface Options { mode?: string }

export function options(value: string | undefined): Options {
  return { mode: value }
}

export function returns(value: boolean): number {
  if (value)
    return 1
}

class Base { method() {} }

export class Child extends Base { method() {} }

export function unreachable(): number {
  return 1
  return 2
}

export function labelled(): void {
  unused: for (;;) {
    break
  }
}
`

const lintFixture = `
export type Choice = 'a' | 'b'

export function pick(choice: Choice): string {
  switch (choice) {
    case 'a':
      return 'a'
  }
}

export function anyValue(value: any): unknown {
  return value
}

export function unsafe(value: any): unknown {
  return value.field
}

export function asserted(value: string | undefined): string {
  return value!
}

export function needless(value: string): string {
  return value as string
}

export function floating(): void {
  Promise.resolve()
}

export function onReady(cb: () => void): void {
  cb()
}

export function misuse(): void {
  onReady(async () => {})
}

export function throwing(): never {
  throw 'boom'
}
`

const compilerGates = [
  ['verbatimModuleSyntax', ['1484']],
  ['exactOptionalPropertyTypes', ['2375', '2379']],
  ['noUncheckedIndexedAccess', ['18048', '2532']],
  ['noImplicitOverride', ['4114']],
  ['allowUnreachableCode', ['7027']],
  ['allowUnusedLabels', ['7028']],
  ['noImplicitReturns', ['7030', '2366']],
] as const

const lintGates = [
  'ts/no-explicit-any',
  'ts/no-floating-promises',
  'ts/no-misused-promises',
  'ts/no-non-null-assertion',
  'ts/no-unnecessary-type-assertion',
  'ts/no-unsafe-member-access',
  'ts/only-throw-error',
  'ts/switch-exhaustiveness-check',
] as const

let failures = 0

function fail(message: string) {
  failures++
  console.error(`not fired: ${message}`)
}

try {
  mkdirSync(probeDir, { recursive: true })
  writeFileSync(join(probeDir, 'tsconfig.json'), JSON.stringify({
    extends: '../tsconfig.json',
    include: ['./types.ts', './marker.ts'],
  }))
  writeFileSync(join(probeDir, 'marker.ts'), 'export type Marker = \'x\'\n')
  writeFileSync(join(probeDir, 'types.ts'), typeFixture)
  writeFileSync(lintProbe, lintFixture)

  const typeRun = spawnSync(tsc, ['-p', probeDir, '--pretty', 'false'], { cwd: root, encoding: 'utf8' })
  const typeOutput = `${typeRun.stdout ?? ''}${typeRun.stderr ?? ''}`
  const codes = new Set([...typeOutput.matchAll(/error TS(\d+)/g)].map(match => match[1]))
  for (const [gate, expected] of compilerGates) {
    if (expected.some(code => codes.has(code)))
      console.log(`compiler gate ${gate}: fired`)
    else
      fail(`compiler gate ${gate}, saw ${[...codes].join(', ') || 'no errors'}`)
  }

  const lintRun = spawnSync(eslint, ['--no-cache', '--format', 'json', lintProbe], { cwd: root, encoding: 'utf8' })
  const parsed: unknown = JSON.parse(String(lintRun.stdout ?? '[]'))
  const rules = new Set<string>()
  if (Array.isArray(parsed)) {
    for (const file of parsed) {
      if (typeof file !== 'object' || file === null || !('messages' in file) || !Array.isArray(file.messages))
        continue
      for (const message of file.messages) {
        if (typeof message === 'object' && message !== null && 'ruleId' in message && typeof message.ruleId === 'string')
          rules.add(message.ruleId)
      }
    }
  }
  for (const rule of lintGates) {
    if (rules.has(rule))
      console.log(`lint gate ${rule}: fired`)
    else
      fail(`lint gate ${rule}, saw ${[...rules].join(', ') || 'none'}`)
  }
}
finally {
  rmSync(probeDir, { recursive: true, force: true })
  rmSync(lintProbe, { force: true })
}

if (failures > 0)
  throw new Error(`type gates: ${failures} did not fire`)

console.log(`type gates: ${compilerGates.length} compiler checks and ${lintGates.length} lint rules fired`)
