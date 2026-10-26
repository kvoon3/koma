import { braces } from '@x18n/builtins/placeholders'
import { definePlugin } from '@x18n/core'

/** `t(key, vars)` substitutes `{name}`; without this the placeholder checks see nothing. */
export default definePlugin({
  name: 'koma-braces',
  placeholders: [braces],
})
