/**
 * The WebView this page was opened in, read off the user agent.
 *
 * WeChat matters because a photo editor needs exactly what it takes away:
 * its built-in browser (WKWebView on iOS, the XWeb/Chromium kernel on
 * Android) blocks saving an exported blob, and its picker re-encodes the
 * photos it hands over. Every platform appends `MicroMessenger/<version>` to
 * the UA, which is the whole signature: there is no API to ask the host app
 * and no API to leave it. iOS refuses every custom scheme, and Android's XWeb
 * kernel swallows `intent://` in most builds, so the escape is a menu the user
 * taps (see `components/WeChatGuard`), not a call.
 */

export type WeChatPlatform = 'ios' | 'android' | 'desktop' | 'unknown'

/** Are we inside WeChat's built-in browser? */
export function isWeChat(): boolean {
  return /MicroMessenger/i.test(navigator.userAgent)
}

/** Which shell of it: iPhone/iPad, Android, or the desktop client? */
export function weChatPlatform(): WeChatPlatform {
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac. `Mobile` is what separates it from WeChat
  // on a real desktop, which carries `Macintosh` and no `Mobile` token.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac OS X/i.test(ua) && /Mobile/i.test(ua)))
    return 'ios'
  if (/Android/i.test(ua))
    return 'android'
  if (/Windows|Macintosh|Mac OS X|Linux/i.test(ua))
    return 'desktop'
  return 'unknown'
}

/**
 * Best effort only: hand Android a VIEW intent for this page, which the system
 * may resolve to the user's browser app. XWeb usually blocks it, and iOS and
 * the desktop client have nothing to call at all, so the caller keeps the
 * manual guide as the real path and a `true` return means no more than "an
 * attempt was made".
 */
export function tryOpenInBrowser(url = location.href): boolean {
  if (weChatPlatform() !== 'android')
    return false
  const scheme = url.startsWith('https') ? 'https' : 'http'
  const a = document.createElement('a')
  a.href = `intent://${url.replace(/^https?:\/\//, '')}`
    + `#Intent;scheme=${scheme}`
    + ';action=android.intent.action.VIEW'
    + ';category=android.intent.category.BROWSABLE'
    // Chrome-style: if nothing accepts the intent, stay on this page instead
    // of leaving the WebView on an "unknown scheme" error.
    + `;S.browser_fallback_url=${encodeURIComponent(url)}`
    + ';end'
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  return true
}
