import type { ButtonHTMLAttributes } from 'react'

type Variant = 'flat' | 'on' | 'strong' | 'close'

export const buttonBase = [
  'inline-flex cursor-pointer items-center gap-[5px] whitespace-nowrap rounded-none border-0',
  'px-[9px] py-[3px] text-[11.5px] text-dim',
  'hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt',
  'focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1',
  'disabled:cursor-default disabled:opacity-35',
  '[&_b]:font-semibold [&_b]:text-accent [&_b]:tabular-nums',
  'pointer-coarse:px-2.5 max-sm:px-2.5',
].join(' ')

export const buttonVariants: Record<Variant, string> = {
  /**
   * `bg-transparent` lives here, not in the base: as a plain utility it sorts
   * after `bg-accent` / `bg-chip-strong` in the output and would silently win
   * the background for the filled variants.
   */
  flat: 'bg-transparent',
  /** Selected chip. `chipOn` is a #f5f5f5 tint on a #ffffff panel, invisible in light; the accent fill reads in both themes. */
  on: 'bg-accent text-on-accent hover:not-disabled:bg-accent hover:not-disabled:text-on-accent',
  strong: 'bg-chip-strong text-txt hover:not-disabled:bg-accent hover:not-disabled:text-on-accent',
  close: 'h-[26px] w-[26px] justify-center p-0 text-faint hover:not-disabled:text-txt',
}

/**
 * A dialog footer button (ConfirmDialog, WeChatGuard): the metrics every
 * dialog in the app shares, with the palette left to the caller. A danger
 * confirm must stay red on hover, and `buttonBase`'s
 * `hover:not-disabled:bg-chip-hover` outranks a plain override, which is why
 * these are written out rather than derived from it; a dialog button is also
 * a size up from a chip button.
 */
export const dialogButton = [
  'inline-flex cursor-pointer items-center rounded-none border',
  'px-3 py-[6px] text-[11.5px] transition-colors duration-[120ms]',
  'focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1',
  'pointer-coarse:px-3.5 pointer-coarse:py-[7px] pointer-coarse:text-xs',
  'max-sm:px-3.5 max-sm:py-[7px] max-sm:text-xs',
].join(' ')

export function Button({ variant = 'flat', className = '', type = 'button', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${buttonBase} ${buttonVariants[variant]}${className ? ` ${className}` : ''}`} {...props} />
}
