// Server registry context: config from REST, runtime overlaid live from the WebSocket.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type Server } from './api'
import { useLive } from './live'

interface Ctx { servers: Server[]; loading: boolean; reload: () => Promise<void> }
const ServersCtx = createContext<Ctx>({ servers: [], loading: true, reload: async () => {} })

export function ServersProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Server[]>([])
  const [loading, setLoading] = useState(true)
  const live = useLive()
  const reload = useCallback(async () => {
    try { setList((await api.get<{ servers: Server[] }>('/servers')).servers) } catch { /* handled by auth */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { reload() }, [reload])

  // Refetch when the set of visible servers changes (granted/revoked/added remotely).
  const ids = Object.keys(live.servers).sort().join(',')
  const lastIds = useRef('')
  useEffect(() => {
    if (!live.connected) return
    if (lastIds.current && ids !== lastIds.current) reload()
    lastIds.current = ids
  }, [ids, live.connected, reload])

  const servers = useMemo(() => list.map(s => (live.servers[s.id] ? { ...s, runtime: live.servers[s.id] } : s)), [list, live.servers])
  return <ServersCtx.Provider value={{ servers, loading, reload }}>{children}</ServersCtx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useServers = () => useContext(ServersCtx)
