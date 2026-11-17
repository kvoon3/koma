import type { FormEvent } from 'react'
import { useState } from 'react'
import { auth } from 'void/client/react'

import { AUTH_IDLE, authTransition, canSubmit } from '../lib/authFlow'
import { notifyAuthChanged } from '../lib/authSession'
import { useT } from '../lib/i18n'
import { useFlow } from '../lib/useFlow'
import { Button } from './ui/button'
import { dialogButton } from './ui/buttonStyles'

/**
 * The sign-in / sign-up screen. One form, two actions: the primary button
 * switches between Sign in and Sign up, so a new visitor can create the
 * account they then sign into. The machine (`src/lib/authFlow`) owns the
 * attempt lifecycle; the auth client's own session state decides whether the
 * app counts as signed-in and lives outside this screen.
 */
export function AuthScreen({ onSignedIn }: { onSignedIn?: (email: string) => void } = {}) {
  const t = useT()
  const { state, send, latest } = useFlow(AUTH_IDLE, authTransition)
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // `send` reads the machine synchronously, so a double submit in one frame
    // cannot start a second request.
    if (!canSubmit(latest()) || !send({ type: 'submit' }))
      return
    try {
      const result = mode === 'signUp'
        ? await auth.signUp.email({ email, password, name: email })
        : await auth.signIn.email({ email, password })
      if (result.error) {
        const message = result.error.status === 429
          ? t('Too many attempts. Try again in a moment.')
          : t('Sign in failed. Check your email and password.')
        send({ type: 'failed', message })
        return
      }
      send({ type: 'resolved', email: result.data.user.email })
      notifyAuthChanged()
      onSignedIn?.(result.data.user.email)
    }
    catch {
      send({ type: 'failed', message: t('Sign in failed. Check your email and password.') })
    }
  }

  const busy = state.phase === 'signingIn'
  const error = state.phase === 'error' ? state.message : null

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-panel px-6">
      <form onSubmit={e => void submit(e)} className="flex w-[min(320px,100%)] flex-col gap-3" data-testid="auth-form">
        <p className="text-[15px] font-semibold text-txt">
          {mode === 'signUp' ? t('Create your account') : t('Sign in to koma')}
        </p>
        <label className="flex flex-col gap-1 text-[11.5px] text-dim">
          {t('Email')}
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={busy}
            className="border border-line bg-panel px-2.5 py-1.5 text-[13px] text-txt outline-none focus-visible:outline-1 focus-visible:outline-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-dim">
          {t('Password')}
          <input
            type="password"
            required
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={busy}
            className="border border-line bg-panel px-2.5 py-1.5 text-[13px] text-txt outline-none focus-visible:outline-1 focus-visible:outline-accent"
          />
        </label>
        {error && (
          <p role="alert" className="text-[11.5px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            className={`${dialogButton} border-0 bg-transparent text-txt hover:bg-chip-hover`}
            onClick={() => setMode(m => (m === 'signIn' ? 'signUp' : 'signIn'))}
          >
            {mode === 'signIn' ? t('Need an account? Sign up') : t('Have an account? Sign in')}
          </button>
          <Button variant="on" type="submit" loading={busy} disabled={busy}>
            {mode === 'signUp' ? t('Sign up') : t('Sign in')}
          </Button>
        </div>
      </form>
    </div>
  )
}
