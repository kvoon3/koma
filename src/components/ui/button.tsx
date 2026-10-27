import type { ButtonHTMLAttributes } from 'react'
import type { Variant } from './buttonStyles'
import { buttonBase, buttonVariants } from './buttonStyles'

/**
 * The app's plain button: one base metric with five palettes (`flat`, `on`,
 * `strong`, `close`, `danger`). The top bar, the dialogs and the library
 * sections render it, so a new surface inherits the shared padding, press
 * scale and focus ring instead of restyling a bare `<button>`.
 */
export function Button({ variant = 'flat', className = '', type = 'button', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${buttonBase} ${buttonVariants[variant]}${className ? ` ${className}` : ''}`} {...props} />
}
