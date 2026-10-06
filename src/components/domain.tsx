/* eslint-disable react-refresh/only-export-components */
// Domain components shared across pages.
import { useId, useState } from 'react'
import {
  Activity as ActivityIcon, Archive, Ban, Box, CircleStop, Crown, FileText, FolderOpen, Globe2, KeyRound, LogIn, Play,
  Power, RotateCcw, Save, ScrollText, Settings, Shield, ShieldCheck, Skull, Terminal, Trash2, Upload, UserMinus, UserPlus, Users, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, type Grant, type Meta, type Role, type Runtime, type Server, type Status } from '@/lib/api'
import { cn } from '@/lib/format'
import { Badge, Button, Checkbox, Menu, MenuContent, MenuItem, MenuTrigger, Segmented, Tip, errorToast, useConfirm } from './ui'

// ---------------- Brand ----------------
export function Logo({ size = 28, withText = true }: { size?: number; withText?: boolean }) {
  // Unique gradient id: a duplicate id inside a hidden (display:none) copy would blank every logo.
  const gid = useId()
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0 drop-shadow-[0_4px_12px_rgba(132,116,255,0.45)]">
        <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#a395ff" /><stop offset="1" stopColor="#5b48f0" /></linearGradient></defs>
        <rect width="32" height="32" rx="8" fill={`url(#${gid})`} />
        <path d="M16 6c-4.4 0-7.5 3.2-7.5 7.4 0 2.3 1 4 2.2 5.2-.3 1.6-1.3 3.4-2.7 4.9 2.2.2 4-.8 5.1-2v4.1c0 .6.4 1 1 1h3.8c.6 0 1-.4 1-1v-4.1c1.1 1.2 2.9 2.2 5.1 2-1.4-1.5-2.4-3.3-2.7-4.9 1.2-1.2 2.2-2.9 2.2-5.2C23.5 9.2 20.4 6 16 6z" fill="#fff" />
        <rect x="12.4" y="11.6" width="2.4" height="3" rx=".6" fill="#3b2fb0" /><rect x="17.2" y="11.6" width="2.4" height="3" rx=".6" fill="#3b2fb0" />
      </svg>
      {withText && <span className="text-[15px] font-semibold tracking-tight">Squid<span className="text-muted">Panel</span></span>}
    </div>
  )
}

// ---------------- Status ----------------
const STATUS: Record<Status, { label: string; dot: string; text: string; ring: string }> = {
  online: { label: 'Online', dot: 'bg-ok', text: 'text-ok', ring: 'border-ok/25 bg-ok/10' },
  starting: { label: 'Starting', dot: 'bg-warn', text: 'text-warn', ring: 'border-warn/25 bg-warn/10' },
  stopping: { label: 'Stopping', dot: 'bg-[#fb923c]', text: 'text-[#fb923c]', ring: 'border-[#fb923c]/25 bg-[#fb923c]/10' },
  offline: { label: 'Offline', dot: 'bg-faint', text: 'text-muted', ring: 'border-line-strong bg-overlay' },
}

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  const s = STATUS[status] || STATUS.offline
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {(status === 'online' || status === 'starting') && <span className={cn('absolute inset-0 rounded-full', s.dot, status === 'online' ? 'animate-ping2' : 'animate-pulse2')} />}
      <span className={cn('relative inline-flex size-2 rounded-full', s.dot)} />
    </span>
  )
}

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const s = STATUS[status] || STATUS.offline
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', s.ring, s.text, className)}>
      <StatusDot status={status} />
      {s.label}
    </span>
  )
}

// ---------------- Server icon ----------------
const SERVER_COLORS: Record<string, string> = {
  emerald: 'from-emerald-400 to-emerald-700', sky: 'from-sky-400 to-sky-700', violet: 'from-violet-400 to-violet-700', amber: 'from-amber-300 to-amber-600',
  rose: 'from-rose-400 to-rose-700', teal: 'from-teal-300 to-teal-700', indigo: 'from-indigo-400 to-indigo-700', lime: 'from-lime-300 to-lime-600',
}
export const SERVER_COLOR_KEYS = Object.keys(SERVER_COLORS)

export function ServerIcon({ server, size = 40, className }: { server: Pick<Server, 'id' | 'name' | 'color' | 'hasIcon'>; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false)
  const initials = server.name.split(/\s+/).filter(w => /[a-z0-9]/i.test(w[0] || '')).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.26) }
  if (server.hasIcon && !broken) {
    return <img src={`/api/servers/${server.id}/icon`} onError={() => setBroken(true)} alt="" style={style} className={cn('pixelated shrink-0 bg-overlay object-cover ring-1 ring-white/10', className)} />
  }
  return (
    <div style={style} className={cn('relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br font-semibold text-white ring-1 ring-white/10', SERVER_COLORS[server.color] || SERVER_COLORS.violet, className)}>
      <span className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.25)_0%,transparent_50%)]" />
      <span className="relative" style={{ fontSize: size * 0.36 }}>{initials}</span>
    </div>
  )
}

// ---------------- Players ----------------
export function PlayerHead({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false)
  const clean = name.replace(/^\./, '')
  if (broken) {
    return <div style={{ width: size, height: size }} className={cn('flex shrink-0 items-center justify-center rounded-[4px] bg-overlay text-[10px] font-semibold text-muted', className)}>{clean[0]?.toUpperCase()}</div>
  }
  return <img src={`https://mc-heads.net/avatar/${encodeURIComponent(clean)}/${size * 2}`} alt="" width={size} height={size} loading="lazy" onError={() => setBroken(true)} className={cn('pixelated shrink-0 rounded-[4px] bg-overlay', className)} />
}

export function PlayerStack({ names, max = 5 }: { names: string[]; max?: number }) {
  if (!names.length) return null
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {names.slice(0, max).map(n => <Tip key={n} content={n}><span><PlayerHead name={n} size={20} className="ring-2 ring-surface" /></span></Tip>)}
      </div>
      {names.length > max && <span className="ml-2 text-xs text-muted">+{names.length - max}</span>}
    </div>
  )
}

// ---------------- People ----------------
export function UserAvatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <div style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h} 70% 62%), hsl(${(h + 40) % 360} 60% 42%))`, fontSize: size * 0.4 }}
      className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-white/10', className)}>
      {name[0]?.toUpperCase()}
    </div>
  )
}

export function RoleBadge({ role }: { role: Role }) {
  if (role === 'owner') return <Badge tone="warn" icon={<Crown />}>Owner</Badge>
  if (role === 'admin') return <Badge tone="brand" icon={<ShieldCheck />}>Admin</Badge>
  return <Badge>Member</Badge>
}

export const CONSOLE_LABELS = ['No console', 'Read only', 'Commands', 'Operator']
export function ConsoleBadge({ level }: { level: number }) {
  const tones = ['neutral', 'info', 'brand', 'warn'] as const
  return <Badge tone={tones[level] || 'neutral'} icon={<Terminal />}>{CONSOLE_LABELS[level]}</Badge>
}

// ---------------- Permission editor ----------------
export function GrantEditor({ meta, value, onChange, ceiling }: { meta: Meta; value: Grant; onChange: (g: Grant) => void; ceiling?: Grant | null }) {
  const allowedPerm = (k: string) => !ceiling || ceiling.perms.includes(k)
  const maxConsole = ceiling ? ceiling.console : 3
  const groups = meta.permissions.reduce<Record<string, typeof meta.permissions>>((acc, p) => { (acc[p.group] ||= []).push(p); return acc }, {})
  const toggle = (k: string, on: boolean) => onChange({ ...value, perms: on ? [...new Set([...value.perms, k])] : value.perms.filter(p => p !== k) })
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-faint">Quick presets</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(meta.presets).map(([key, p]) => {
            const ok = p.console <= maxConsole && p.perms.every(allowedPerm)
            const active = value.console === p.console && p.perms.length === value.perms.length && p.perms.every(x => value.perms.includes(x))
            return (
              <button key={key} type="button" disabled={!ok} onClick={() => onChange({ console: p.console, perms: [...p.perms] })}
                className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-35',
                  active ? 'border-brand/50 bg-brand/15 text-[#c4bbff]' : 'border-line-strong/70 text-muted hover:border-line-strong hover:text-fg')}>
                {p.label}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-faint">Console access</div>
        <Segmented
          className="flex w-full"
          value={value.console}
          onChange={v => onChange({ ...value, console: v })}
          options={meta.consoleLevels.filter(l => l.level <= maxConsole).map(l => ({ value: l.level, label: l.label, title: l.description }))}
        />
        <p className="mt-1.5 text-xs text-faint">{meta.consoleLevels.find(l => l.level === value.console)?.description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(groups).map(([group, perms]) => (
          <div key={group}>
            <div className="mb-2 text-2xs font-medium uppercase tracking-wider text-faint">{group}</div>
            <div className="space-y-1">
              {perms.map(p => {
                const ok = allowedPerm(p.key)
                return (
                  <label key={p.key} className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-overlay/60', !ok && 'cursor-not-allowed opacity-40')}>
                    <Checkbox checked={value.perms.includes(p.key)} onChange={v => ok && toggle(p.key, v)} disabled={!ok} />
                    {p.label}
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function grantSummary(g: Grant | null | undefined, meta: Meta | null) {
  if (!g) return 'No access'
  const parts = [CONSOLE_LABELS[g.console]]
  if (g.perms.length && meta) parts.push(...g.perms.map(p => meta.permissions.find(x => x.key === p)?.label || p))
  return parts.join(' · ')
}

// ---------------- Power controls ----------------
export function PowerControls({ server, runtime, onChange, compact }: { server: Server; runtime: Runtime; onChange?: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()
  const can = (p: string) => server.access.perms.includes(p)
  const act = async (action: 'start' | 'stop' | 'restart' | 'kill') => {
    if (action === 'kill' && !(await confirm({ title: 'Force kill the server?', body: 'The process is terminated immediately without saving. Only use this if the server is frozen.', confirmText: 'Kill now', tone: 'danger' }))) return
    if (action === 'stop' && runtime.players.length && !(await confirm({ title: `Stop ${server.name}?`, body: `${runtime.players.length} player${runtime.players.length > 1 ? 's are' : ' is'} online and will be disconnected.`, confirmText: 'Stop server', tone: 'danger' }))) return
    setBusy(action)
    try {
      await api.post(`/servers/${server.id}/${action}`)
      toast.success({ start: 'Starting server…', stop: 'Stopping server…', restart: 'Restarting server…', kill: 'Server killed' }[action])
      onChange?.()
    } catch (e) {
      const err = e as { data?: { code?: string } }
      if (err.data?.code === 'eula') {
        if (await confirm({ title: 'Accept the Minecraft EULA?', body: <>This server has not accepted the <a className="text-brand underline" href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">Minecraft EULA</a>. Accept it to start.</>, confirmText: 'Accept & start' })) {
          try { await api.post(`/servers/${server.id}/eula`); await api.post(`/servers/${server.id}/start`); toast.success('Starting server…') } catch (e2) { errorToast(e2) }
        }
      } else errorToast(e)
    } finally {
      setBusy(null)
    }
  }
  const st = runtime.status
  const running = st !== 'offline' || !!runtime.pid
  return (
    <div className="flex items-center gap-2">
      {!running && can('power.start') && (
        <Button variant="success" size={compact ? 'sm' : 'md'} loading={busy === 'start'} disabled={!!runtime.busy} icon={<Play className="fill-current" />} onClick={() => act('start')}>Start</Button>
      )}
      {running && can('power.stop') && (
        <Button variant="danger" size={compact ? 'sm' : 'md'} loading={busy === 'stop'} disabled={st === 'stopping'} icon={<CircleStop />} onClick={() => act('stop')}>{st === 'stopping' ? 'Stopping…' : 'Stop'}</Button>
      )}
      {running && can('power.stop') && can('power.start') && !compact && (
        <Button variant="secondary" loading={busy === 'restart'} disabled={st !== 'online'} icon={<RotateCcw />} onClick={() => act('restart')}>Restart</Button>
      )}
      {running && can('power.stop') && !compact && (
        <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More power options"><Power /></Button></MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Zap />} danger onSelect={() => act('kill')}>Force kill</MenuItem>
          </MenuContent>
        </Menu>
      )}
    </div>
  )
}

// ---------------- Activity rendering ----------------
const ACTION_META: Record<string, { icon: React.ReactNode; text: string; tone?: string }> = {
  'server.start': { icon: <Play />, text: 'started the server', tone: 'text-ok' },
  'server.stop': { icon: <CircleStop />, text: 'stopped the server' },
  'server.autostop': { icon: <CircleStop />, text: 'auto-stopped the idle server' },
  'server.kill': { icon: <Zap />, text: 'force killed the server', tone: 'text-bad' },
  'server.crash': { icon: <Skull />, text: 'server crashed', tone: 'text-bad' },
  'server.detected': { icon: <Globe2 />, text: 'detected a server started outside the panel' },
  'server.settings': { icon: <Settings />, text: 'changed server settings' },
  'server.properties': { icon: <Settings />, text: 'edited server.properties' },
  'server.add': { icon: <Box />, text: 'added a server', tone: 'text-ok' },
  'server.remove': { icon: <Trash2 />, text: 'removed a server', tone: 'text-bad' },
  'server.eula': { icon: <FileText />, text: 'accepted the EULA' },
  'server.rcon_on': { icon: <Terminal />, text: 'enabled RCON' },
  'server.rcon_off': { icon: <Terminal />, text: 'disabled RCON' },
  'console.command': { icon: <Terminal />, text: 'ran' },
  'backup.create': { icon: <Archive />, text: 'created a backup' },
  'backup.auto': { icon: <Archive />, text: 'automatic backup' },
  'backup.restore': { icon: <RotateCcw />, text: 'restored a backup', tone: 'text-warn' },
  'backup.delete': { icon: <Trash2 />, text: 'deleted a backup' },
  'backup.failed': { icon: <Archive />, text: 'backup failed', tone: 'text-bad' },
  'file.edit': { icon: <FileText />, text: 'edited' },
  'file.upload': { icon: <Upload />, text: 'uploaded files to' },
  'file.delete': { icon: <Trash2 />, text: 'deleted' },
  'file.rename': { icon: <FolderOpen />, text: 'renamed' },
  'addon.upload': { icon: <Upload />, text: 'uploaded' },
  'addon.install': { icon: <Box />, text: 'installed', tone: 'text-ok' },
  'addon.delete': { icon: <Trash2 />, text: 'removed' },
  'addon.enable': { icon: <Box />, text: 'enabled' },
  'addon.disable': { icon: <Box />, text: 'disabled' },
  'world.activate': { icon: <Globe2 />, text: 'switched world to' },
  'world.upload': { icon: <Upload />, text: 'uploaded world' },
  'world.delete': { icon: <Trash2 />, text: 'deleted world', tone: 'text-bad' },
  'player.kick': { icon: <UserMinus />, text: 'kicked' },
  'player.ban': { icon: <Ban />, text: 'banned', tone: 'text-bad' },
  'player.pardon': { icon: <ShieldCheck />, text: 'unbanned' },
  'player.op': { icon: <Crown />, text: 'opped', tone: 'text-warn' },
  'player.deop': { icon: <Crown />, text: 'de-opped' },
  'player.whitelist-add': { icon: <UserPlus />, text: 'whitelisted' },
  'player.whitelist-remove': { icon: <UserMinus />, text: 'removed from whitelist' },
  'player.whitelist-on': { icon: <Shield />, text: 'turned the whitelist on' },
  'player.whitelist-off': { icon: <Shield />, text: 'turned the whitelist off' },
  'user.create': { icon: <UserPlus />, text: 'created account', tone: 'text-ok' },
  'user.update': { icon: <Users />, text: 'updated account' },
  'user.delete': { icon: <UserMinus />, text: 'deleted account', tone: 'text-bad' },
  'access.grant': { icon: <KeyRound />, text: 'granted access to' },
  'access.revoke': { icon: <KeyRound />, text: 'revoked access for' },
  'account.login': { icon: <LogIn />, text: 'signed in' },
  'account.login_failed': { icon: <Shield />, text: 'failed sign-in attempt', tone: 'text-bad' },
  'account.password': { icon: <KeyRound />, text: 'changed their password' },
  'account.setup': { icon: <Crown />, text: 'set up SquidPanel', tone: 'text-warn' },
  'panel.settings': { icon: <Settings />, text: 'changed panel settings' },
  'playit.start': { icon: <Globe2 />, text: 'started the playit agent' },
  'playit.stop': { icon: <Globe2 />, text: 'stopped the playit agent' },
  'playit.tunnel_on': { icon: <Globe2 />, text: 'opened the playit tunnel', tone: 'text-ok' },
  'playit.tunnel_off': { icon: <Globe2 />, text: 'closed the playit tunnel' },
}
export function actionMeta(action: string) {
  return ACTION_META[action] || { icon: action.startsWith('backup') ? <Save /> : action.startsWith('server') ? <ScrollText /> : <ActivityIcon />, text: action.replace(/[._]/g, ' ') }
}
