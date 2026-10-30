import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import { GROUPS_PATH, OVERVIEW_PATH } from '../../lib/routes'
import { viewTransitionOption } from '../../lib/viewTransition'
import { useStore } from '../../store'

export interface GroupsNav {
  open: () => void
  close: () => void
}

export function useGroupsNav(): GroupsNav {
  const navigate = useNavigate()
  const router = useRouter()

  const open = useCallback(() => {
    useStore.getState().clearSelection()
    // The entry state rides the history entry, so Done can go Back after a
    // StrictMode rehearsal, a reload or a Forward, while a deep link has none.
    void navigate({ to: GROUPS_PATH, state: { fromOverview: true }, viewTransition: viewTransitionOption() })
  }, [navigate])

  const close = useCallback(() => {
    useStore.getState().clearSelection()
    const fromOverview = router.state.location.state.fromOverview === true
    if (fromOverview && router.history.length > 1) {
      router.history.back()
      return
    }
    void navigate({ to: OVERVIEW_PATH, replace: true, viewTransition: viewTransitionOption() })
  }, [navigate, router])

  return { open, close }
}
