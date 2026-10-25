/**
 * The class strings behind `Button` and the dialogs, in a module of their own:
 * a .tsx file that exports both components and non-component values loses its
 * Fast Refresh boundary (`react-doctor/only-export-components`), and these are
 * imported directly wherever a raw element needs the same metrics (a
 * `Dialog.Close`, an `<a>` styled as a chip).
 */

export type Variant = 'flat' | 'on' | 'strong' | 'close' | 'danger' | 'float'

/**
 * Border width and padding sit in the variants, not here: same-property
 * utilities resolve by stylesheet order, so a base `border-0` or `px-[9px]`
 * would outrank the square variants' `border` and `p-0`.
 */
export const buttonBase = [
  'inline-flex cursor-pointer items-center gap-[5px] whitespace-nowrap rounded-none',
  'text-[11.5px] text-dim',
  'hover:not-disabled:bg-chip-hover hover:not-disabled:text-txt',
  'transition-[background-color,border-color,color,scale] duration-(--dur-fast)',
  'active:scale-[0.97]',
  'focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1',
  'disabled:cursor-default disabled:opacity-35',
  '[&_b]:font-semibold [&_b]:text-accent [&_b]:tabular-nums',
].join(' ')

const textBox = 'border-0 px-[9px] py-[3px] pointer-coarse:px-2.5 max-sm:px-2.5'

export const buttonVariants: Record<Variant, string> = {
  /**
   * `bg-transparent` lives here, not in the base: as a plain utility it sorts
   * after `bg-accent` / `bg-chip-strong` in the output and would silently win
   * the background for the filled variants.
   */
  flat: `bg-transparent ${textBox}`,
  /** Selected chip. `chipOn` is a #f5f5f5 tint on a #ffffff panel, invisible in light; the accent fill reads in both themes. */
  on: `${textBox} bg-accent text-on-accent hover:not-disabled:bg-accent hover:not-disabled:text-on-accent`,
  strong: `${textBox} bg-chip-strong text-txt hover:not-disabled:bg-accent hover:not-disabled:text-on-accent`,
  close: 'h-[26px] w-[26px] justify-center border-0 p-0 text-faint hover:not-disabled:text-txt',
  /** A destructive action's resting state (dialog footer, detail panel): red on hover, never on plain. */
  danger: `${textBox} bg-transparent text-danger hover:not-disabled:bg-danger hover:not-disabled:text-on-accent`,
  /**
   * The floating-chip idiom shared by FloatActions and the board's caption row;
   * ViewZoomChip keeps its own component because its chip also carries text and
   * a min width.
   */
  float: 'h-[30px] w-[30px] justify-center border border-float-line bg-float-bg p-0 text-float-icon backdrop-blur-[7px] pointer-coarse:h-[38px] pointer-coarse:w-[38px]',
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
  'px-3 py-[6px] text-[11.5px] transition-[background-color,border-color,color,scale] duration-(--dur-fast)',
  'active:scale-[0.97]',
  'focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-1',
  'pointer-coarse:px-3.5 pointer-coarse:py-[7px] pointer-coarse:text-xs',
  'max-sm:px-3.5 max-sm:py-[7px] max-sm:text-xs',
].join(' ')
