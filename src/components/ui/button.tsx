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

export function Button({ variant = 'flat', className = '', type = 'button', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`${buttonBase} ${buttonVariants[variant]}${className ? ` ${className}` : ''}`} {...props} />
}
