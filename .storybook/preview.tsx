import type { Decorator } from '@storybook/react-vite'
import type { Lang } from '../src/lib/i18n'
import type { ThemePref } from '../src/theme'
import { definePreview } from '@storybook/react-vite'
import { useLayoutEffect } from 'react'
import { setLang } from '../src/lib/i18n'
import { applyTheme, initTheme } from '../src/theme'
import '../src/index.css'

/** The app boots in this order too: storage first, then the resolved class. */
localStorage.setItem('theme', 'auto')
initTheme()

/**
 * The app has no context providers: theme and language are module stores that
 * write `html.dark` and `html.lang`. So the decorator drives those same
 * stores from the toolbar globals, and the canvas carries the app's own
 * background and text tokens.
 */
const AppShell: Decorator = (Story, context) => {
  const theme = context.globals.theme as ThemePref
  const locale = context.globals.locale as Lang

  useLayoutEffect(() => {
    localStorage.setItem('theme', theme)
    applyTheme()
    setLang(locale)
  }, [theme, locale])

  return (
    <div className="bg-canvas p-8 text-txt">
      <Story />
    </div>
  )
}

export default definePreview({
  decorators: [AppShell],
  globalTypes: {
    theme: {
      description: 'The app theme, stored under the same key the app reads',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: ['auto', 'light', 'dark'],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'The interface language',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'zh-Hans', title: '简体中文' },
          { value: 'zh-Hant', title: '繁體中文' },
          { value: 'ja', title: '日本語' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'auto',
    locale: 'en',
  },
})
