const colors = ['#f2a7c5', '#8edfd5', '#9db4ea'] as const
function oldColor(step: number) {
  return colors[((step % 3) + 3) % 3]
}
function newColor(step: number) {
  const turn = ((step % 3) + 3) % 3
  if (turn === 0)
    return colors[0]
  if (turn === 1)
    return colors[1]
  if (turn === 2)
    return colors[2]
  throw new Error('Holographic gradient stop is not a whole turn.')
}
let checked = 0
for (let step = -5000; step <= 5000; step += 1) {
  if (oldColor(step) !== newColor(step))
    throw new Error(`color differs at ${step}`)
  checked += 1
}
for (const step of [NaN, -Infinity, Infinity, 0.5]) {
  let threw = false
  try { newColor(step) } catch { threw = true }
  if (!threw)
    throw new Error(`newColor accepted out-of-domain step ${step}`)
  checked += 1
}
console.log(`holographic color parity: ${checked} steps, finite steps identical, out-of-domain steps throw`)
