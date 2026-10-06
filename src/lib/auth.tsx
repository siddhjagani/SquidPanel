import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, type Meta, type User } from './api'
import { startLive, stopLive } from './live'

interface AuthState {
  user: User | null
  meta: Meta | null
  loading: boolean
  setup: { needed: boolean; allowed: boolean } | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
  isAdmin: boolean
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [setup, setSetup] = useState<AuthState['setup']>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: User; meta: Meta }>('/auth/me')
      setUser(r.user)
      setMeta(r.meta)
      startLive()
    } catch {
      setUser(null)
      stopLive()
      try { setSetup(await api.get('/setup')) } catch { /* offline */ }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    setUnauthorizedHandler(() => { setUser(null); stopLive() })
  }, [refresh])

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout') } catch { /* ignore */ }
    stopLive()
    setUser(null)
    setSetup({ needed: false, allowed: false })
  }, [])

  const isAdmin = user?.role === 'owner' || user?.role === 'admin'
  return <Ctx.Provider value={{ user, meta, loading, setup, refresh, logout, isAdmin }}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside provider')
  return c
}
