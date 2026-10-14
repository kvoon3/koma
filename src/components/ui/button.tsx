import type { ButtonHTMLAttributes } from 'react'
import type { Variant } from './buttonStyles'
import { buttonBase, buttonVariants } from './buttonStyles'

export function Button({ variant = 'flat', className = '', type = 'button', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${buttonBase} ${buttonVariants[variant]}${className ? ` ${className}` : ''}`} {...props} />
}
