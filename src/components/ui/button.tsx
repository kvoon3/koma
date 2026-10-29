import type { IconNode } from 'lucide'
import type { ButtonHTMLAttributes, Ref } from 'react'
import type { Variant } from './buttonStyles'
import { MorphIcon } from 'morphicons/react'
import { buttonBase, buttonVariants } from './buttonStyles'
import { Spinner } from './spinner'

/**
 * The app's plain button: one base metric with eight palettes (`flat`, `bar`,
 * `on`, `strong`, `close`, `danger`, `float`, `ghost`). The top bar, the dialogs,
 * the library sections and the floating chrome render it, so a new surface
 * inherits the shared padding, press scale and focus ring instead of restyling a
 * bare `<button>`.
 */
export function Button({ variant = 'flat', icon, iconSize = 13, loading = false, className = '', type = 'button', disabled, children, onClick, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant
    /** Leading icon: the button draws it, so loading can take its slot. */
    icon?: IconNode
    /** The icon's px size: 13 beside text, 15 in the float chips. */
    iconSize?: number
    /** A leading spinner replaces the icon while busy; clicks are ignored, aria-busy set. */
    loading?: boolean
    /** The button element, for anchoring a panel to its trigger. */
    ref?: Ref<HTMLButtonElement>
  }) {
  return (
    <button
      type={type}
      className={`${buttonBase} ${buttonVariants[variant]}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      onClick={(e) => {
        if (!loading)
          onClick?.(e)
      }}
      {...props}
      aria-busy={loading || undefined}
    >
      {loading
        ? <Spinner size={iconSize} strokeWidth={1.75} />
        : icon && <MorphIcon icon={icon} size={iconSize} strokeWidth={1.75} />}
      {children}
    </button>
  )
}
