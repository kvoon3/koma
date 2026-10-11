// Shared hidden <input type="file"> so any component can open the native
// picker without owning a ref (a fresh input per call would leak DOM nodes).
let input: HTMLInputElement | null = null
let onPick: ((files: File[]) => void) | null = null

export function pickImageFiles(cb: (files: File[]) => void): void {
  if (!input) {
    input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,.heic,.heif,.hif,.mov'
    input.multiple = true
    input.hidden = true
    input.addEventListener('change', () => {
      const files = [...(input?.files ?? [])]
      const picked = onPick
      if (input)
        input.value = ''
      if (files.length)
        picked?.(files)
    })
    document.body.appendChild(input)
  }
  onPick = cb
  input.click()
}
