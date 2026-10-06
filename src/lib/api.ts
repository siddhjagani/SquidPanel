// Typed API client. All calls are same-origin with the session cookie; mutating
// calls carry the x-squidpanel header the server uses as a CSRF guard.

export type Role = 'owner' | 'admin' | 'member'
export type Status = 'offline' | 'starting' | 'online' | 'stopping'

export interface Grant { console: number; perms: string[] }
export interface Access { view: boolean; console: number; perms: string[]; role: Role | null }

export interface User {
  id: string; username: string; displayName: string; role: Role; disabled: boolean
  createdAt: number; createdBy: string | null; lastLoginAt: number | null; grants: Record<string, Grant>
}

export interface Meta {
  permissions: { key: string; label: string; group: string }[]
  consoleLevels: { level: number; key: string; label: string; description: string }[]
  presets: Record<string, { label: string; console: number; perms: string[] }>
  defaultRestricted: string[]
}

export interface Job { serverId: string; type: 'backup' | 'restore'; status: 'running' | 'done' | 'error'; step: string; bytes?: number; file?: string; error?: string; startedAt?: number }

export interface Runtime {
  id: string; status: Status; mode: 'managed' | 'external' | null; pid: number | null
  startedAt: number | null; onlineAt: number | null; cpu: number; memMb: number; memLimitMb: number
  players: string[]; maxPlayers: number; port: number | null
  idle: { enabled: boolean; minutes: number; since: number | null }
  console: 'stdin' | 'rcon' | null; busy: string | null; lastCrash: number | null; job?: Job | null
  tunnels?: { address: string; type: string; active: boolean }[]
}

export interface ServerSettings { autoStop: boolean; idleMinutes: number; autoStart: boolean; restartOnCrash: boolean; stopTimeout: number; restrictedCommands: string[] }
export interface BackupSettings { enabled: boolean; everyHours: number; keep: number; lastAuto: number | null; onlyWhenUsed: boolean }
export interface LaunchSettings { type: 'auto' | 'jar' | 'script' | 'custom'; java: string; jar: string; script: string; minRam: string; maxRam: string; jvmArgs: string; custom: string }

export interface Server {
  id: string; name: string; address: string; color: string; software: string; mcVersion: string; loaderVersion: string | null
  hasIcon: boolean; addonsDir: 'mods' | 'plugins' | null; eula: boolean; motd: string; launchType: string
  settings: ServerSettings; backup: BackupSettings; access: Access; runtime: Runtime; missing: boolean
  dir?: string; launch?: LaunchSettings
}

// The address players should use: the configured one, else the server's playit Java tunnel.
export function joinAddress(s: Pick<Server, 'address' | 'runtime'>): string | null {
  if (s.address) return s.address
  const t = s.runtime.tunnels || []
  return (t.find(x => x.type === 'minecraft-java') || t[0])?.address || null
}

export interface Host {
  hostname: string; platform: string; arch: string; cpuModel: string; cores: number; cpu: number
  memTotal: number; memFree: number; uptime: number; load: number[]; disk: { total: number; free: number } | null
  panel: { version: string; node: string; uptime: number; dataDir: string }
}

export interface Activity { id: string; ts: number; actor: string; action: string; serverId: string | null; detail: string }
export interface LogLine { t: number; l: string; k?: 'panel' | 'cmd' | 'rcon'; u?: string }

export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message)
    this.status = status
    this.data = data
  }
}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { 'x-squidpanel': '1' } }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
  }
  const res = await fetch('/api' + path, init)
  let data: Record<string, unknown> = {}
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login') && onUnauthorized) onUnauthorized()
    throw new ApiError(String(data.error || `Request failed (${res.status})`), res.status, data)
  }
  return data as T
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
  upload: <T>(p: string, form: FormData, onProgress?: (pct: number) => void) =>
    new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api' + p)
      xhr.setRequestHeader('x-squidpanel', '1')
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)) }
      xhr.onload = () => {
        let data: Record<string, unknown> = {}
        try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data as T)
        else reject(new ApiError(String(data.error || `Upload failed (${xhr.status})`), xhr.status, data))
      }
      xhr.onerror = () => reject(new ApiError('Network error during upload', 0, {}))
      xhr.send(form)
    }),
}

export const q = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const str = s.toString()
  return str ? '?' + str : ''
}
