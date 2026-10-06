// One WebSocket per tab: live server summaries, host stats, console streams and activity.
import { useEffect, useSyncExternalStore } from 'react'
import type { Activity, Host, LogLine, Runtime } from './api'

type ConsoleListener = (ev: { type: 'init'; lines: LogLine[]; channel: string | null } | { type: 'lines'; lines: LogLine[] }) => void

interface State { connected: boolean; servers: Record<string, Runtime>; host: Host | null; version: number }

let state: State = { connected: false, servers: {}, host: null, version: 0 }
const listeners = new Set<() => void>()
const consoleListeners = new Map<string, Set<ConsoleListener>>()
const activityListeners = new Set<(a: Activity) => void>()
let ws: WebSocket | null = null
let retry = 0
let started = false
let stopped = false

function emit(patch: Partial<State>) {
  state = { ...state, ...patch, version: state.version + 1 }
  listeners.forEach(l => l())
}

function connect() {
  if (stopped) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws`)
  ws.onopen = () => {
    retry = 0
    emit({ connected: true })
    for (const id of consoleListeners.keys()) ws?.send(JSON.stringify({ t: 'sub', id }))
  }
  ws.onclose = () => {
    emit({ connected: false })
    if (stopped) return
    retry = Math.min(retry + 1, 6)
    setTimeout(connect, 400 * 2 ** retry)
  }
  ws.onmessage = ev => {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.t === 'servers') {
      const servers: Record<string, Runtime> = {}
      for (const s of msg.servers) servers[s.id] = s
      emit({ servers, host: msg.host ?? state.host })
    } else if (msg.t === 'server') {
      emit({ servers: { ...state.servers, [msg.server.id]: msg.server } })
    } else if (msg.t === 'console-init') {
      consoleListeners.get(msg.id)?.forEach(l => l({ type: 'init', lines: msg.lines, channel: msg.channel }))
    } else if (msg.t === 'console') {
      consoleListeners.get(msg.id)?.forEach(l => l({ type: 'lines', lines: msg.lines }))
    } else if (msg.t === 'activity') {
      activityListeners.forEach(l => l(msg.entry))
    }
  }
}

export function startLive() {
  stopped = false
  if (started) return
  started = true
  connect()
}

export function stopLive() {
  stopped = true
  started = false
  ws?.close()
  ws = null
  state = { connected: false, servers: {}, host: null, version: 0 }
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export function useLive() {
  return useSyncExternalStore(subscribe, () => state)
}

export function useRuntime(id: string | undefined, fallback?: Runtime): Runtime | undefined {
  const s = useLive()
  return (id && s.servers[id]) || fallback
}

export function useConsole(id: string | undefined, fn: ConsoleListener) {
  useEffect(() => {
    if (!id) return
    if (!consoleListeners.has(id)) consoleListeners.set(id, new Set())
    const set = consoleListeners.get(id)!
    set.add(fn)
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'sub', id }))
    return () => {
      set.delete(fn)
      if (!set.size) {
        consoleListeners.delete(id)
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'unsub', id }))
      }
    }
  }, [id, fn])
}

export function useActivityFeed(fn: (a: Activity) => void) {
  useEffect(() => {
    activityListeners.add(fn)
    return () => { activityListeners.delete(fn) }
  }, [fn])
}
