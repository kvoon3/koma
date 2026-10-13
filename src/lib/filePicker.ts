// Shared hidden <input type="file"> so any component can open the native
// picker without owning a ref (a fresh input per call would leak DOM nodes).
// The folder picker is a second input: `webkitdirectory` is fixed at creation.
let fileInput: HTMLInputElement | null = null
let dirInput: HTMLInputElement | null = null
let onPick: ((files: File[]) => void) | null = null

function makeInput(root: boolean): HTMLInputElement {
  const el = document.createElement('input')
  el.type = 'file'
  el.accept = 'image/*,.heic,.heif,.hif,.mov'
  el.multiple = true
  el.hidden = true
  if (root)
    el.webkitdirectory = true
  el.addEventListener('change', () => {
    const files = [...(el.files ?? [])]
    const picked = onPick
    el.value = ''
    if (files.length)
      picked?.(files)
  })
  document.body.appendChild(el)
  return el
}

export function pickImageFiles(cb: (files: File[]) => void): void {
  fileInput ??= makeInput(false)
  onPick = cb
  fileInput.click()
}

/** Pick a whole folder: every image below it arrives in one batch. */
export function pickImageFolder(cb: (files: File[]) => void): void {
  dirInput ??= makeInput(true)
  onPick = cb
  dirInput.click()
}
