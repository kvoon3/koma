import darkSvg from '../assets/brand/favicon-dark.svg?raw'
import lightSvg from '../assets/brand/favicon-light.svg?raw'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`

const LIGHT = toDataUri(lightSvg)
const DARK = toDataUri(darkSvg)

/**
 * The tab favicon is the mark alone, so it cannot use a background tile to stay
 * legible across themes: it swaps with the resolved app theme instead. The
 * inline SVG's media query only covers the pre-JS/OS instant before this runs.
 */
export function syncFavicon(dark: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[data-koma-favicon]')
  if (link)
    link.href = dark ? DARK : LIGHT
}
