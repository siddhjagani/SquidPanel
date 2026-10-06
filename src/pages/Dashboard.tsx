import { Link } from 'react-router'
import { ArrowUpRight, Cpu, HardDrive, MemoryStick, Moon, Plus, Server as ServerIcon2, Timer, Users } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useLive } from '@/lib/live'
import { useServers } from '@/lib/servers'
import { useNow } from '@/lib/hooks'
import { bytes, cn, duration, mb } from '@/lib/format'
import { joinAddress, type Server } from '@/lib/api'
import { Badge, Button, Card, CopyButton, Empty, PageHeader, Progress, Skeleton, Stat } from '@/components/ui'
import { PlayerStack, PowerControls, ServerIcon, StatusPill } from '@/components/domain'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function IdleNote({ s, now }: { s: Server; now: number }) {
  const rt = s.runtime
  if (rt.status === 'starting') return <span className="flex items-center gap-1.5 text-warn"><Timer className="size-3.5" />Booting up…</span>
  if (rt.status !== 'online') return null
  if (rt.idle.enabled && rt.idle.since && !rt.players.length) {
    const left = rt.idle.minutes * 60000 - (now - rt.idle.since)
    return <span className="flex items-center gap-1.5 text-muted"><Moon className="size-3.5" />Sleeps in {duration(Math.max(0, left))}</span>
  }
  if (rt.onlineAt) return <span className="flex items-center gap-1.5 text-muted"><Timer className="size-3.5" />Up {duration(now - rt.onlineAt)}</span>
  return null
}

function ServerCard({ s, now, cores }: { s: Server; now: number; cores: number }) {
  const rt = s.runtime
  const running = rt.status !== 'offline'
  const ramCap = rt.memLimitMb || 4096
  return (
    <Card className="group relative flex flex-col overflow-hidden transition-colors hover:border-line-strong">
      {rt.status === 'online' && <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-ok/[0.07] to-transparent" />}
      <Link to={`/servers/${s.id}`} className="relative flex items-start gap-3.5 p-5 pb-4">
        <ServerIcon server={s} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold tracking-tight">{s.name}</h3>
            <ArrowUpRight className="size-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge>{s.software}</Badge>
            {s.mcVersion && <Badge>{s.mcVersion}</Badge>}
            {rt.mode === 'external' && <Badge tone="info">external</Badge>}
          </div>
        </div>
        <StatusPill status={rt.status} />
      </Link>

      <div className="relative grid grid-cols-3 gap-px border-y border-line bg-line">
        <div className="bg-surface px-4 py-3">
          <div className="flex items-center gap-1.5 text-2xs text-faint"><Users className="size-3" />Players</div>
          <div className="mt-1 text-sm font-semibold tabular">{running ? <>{rt.players.length}<span className="text-faint">/{rt.maxPlayers}</span></> : <span className="text-faint">—</span>}</div>
        </div>
        <div className="bg-surface px-4 py-3">
          <div className="flex items-center gap-1.5 text-2xs text-faint"><Cpu className="size-3" />CPU</div>
          <div className="mt-1 text-sm font-semibold tabular">{rt.pid ? `${Math.round(rt.cpu / cores)}%` : <span className="text-faint">—</span>}</div>
          {rt.pid ? <Progress value={rt.cpu / cores} className="mt-1.5 h-1" tone={rt.cpu / cores > 85 ? 'bad' : 'brand'} /> : null}
        </div>
        <div className="bg-surface px-4 py-3">
          <div className="flex items-center gap-1.5 text-2xs text-faint"><MemoryStick className="size-3" />Memory</div>
          <div className="mt-1 text-sm font-semibold tabular">{rt.pid ? mb(rt.memMb) : <span className="text-faint">—</span>}</div>
          {rt.pid ? <Progress value={(rt.memMb / ramCap) * 100} className="mt-1.5 h-1" tone="ok" /> : null}
        </div>
      </div>

      <div className="relative flex min-h-[60px] flex-1 items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0 text-xs">
          {rt.players.length ? <PlayerStack names={rt.players} /> : <IdleNote s={s} now={now} />}
          {!running && (joinAddress(s) ? (
            <div className="flex items-center gap-1 text-muted"><span className="truncate font-mono">{joinAddress(s)}</span><CopyButton value={joinAddress(s)!} /></div>
          ) : <span className="text-faint">Port {rt.port ?? '—'}</span>)}
        </div>
        <PowerControls server={s} runtime={rt} compact />
      </div>
      {rt.job && (
        <div className="relative border-t border-line px-5 py-2 text-xs text-muted">
          <span className="text-brand">{rt.job.type === 'restore' ? 'Restoring' : 'Backing up'}</span> · {rt.job.step}{rt.job.bytes ? ` · ${bytes(rt.job.bytes)}` : ''}
        </div>
      )}
    </Card>
  )
}

export default function Dashboard() {
  const { user, isAdmin } = useAuth()
  const { servers, loading } = useServers()
  const { host } = useLive()
  const now = useNow(1000)
  const online = servers.filter(s => s.runtime.status === 'online')
  const players = servers.reduce((n, s) => n + s.runtime.players.length, 0)
  const cores = host?.cores || navigator.hardwareConcurrency || 8
  const memUsed = host ? host.memTotal - host.memFree : 0

  return (
    <div className="mx-auto max-w-[1280px] px-5 py-7 lg:px-8">
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        title={`${greeting()}, ${user!.displayName}`}
        description={servers.length ? `${online.length} of ${servers.length} servers online · ${players} player${players === 1 ? '' : 's'} playing` : undefined}
        actions={isAdmin && <Link to="/settings"><Button icon={<Plus />}>Add server</Button></Link>}
      />

      {isAdmin && host && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Host CPU" icon={<Cpu />} value={`${Math.round(host.cpu)}%`} sub={`${host.cores} cores · load ${host.load[0].toFixed(2)}`}>
            <Progress value={host.cpu} className="mt-3" tone={host.cpu > 85 ? 'bad' : 'brand'} />
          </Stat>
          <Stat label="Host memory" icon={<MemoryStick />} value={bytes(memUsed)} sub={`of ${bytes(host.memTotal)}`}>
            <Progress value={(memUsed / host.memTotal) * 100} className="mt-3" tone={memUsed / host.memTotal > 0.9 ? 'warn' : 'ok'} />
          </Stat>
          <Stat label="Disk free" icon={<HardDrive />} value={host.disk ? bytes(host.disk.free) : '—'} sub={host.disk ? `of ${bytes(host.disk.total)}` : undefined}>
            {host.disk && <Progress value={(1 - host.disk.free / host.disk.total) * 100} className="mt-3" tone={host.disk.free / host.disk.total < 0.1 ? 'bad' : 'brand'} />}
          </Stat>
          <Stat label={host.hostname} icon={<ServerIcon2 />} value={duration(host.uptime * 1000)} sub={`host uptime · panel v${host.panel.version}`} />
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-[230px] rounded-xl" />)}</div>
      ) : servers.length ? (
        <div className={cn('grid gap-4 md:grid-cols-2', servers.length > 2 && 'xl:grid-cols-3')}>
          {servers.map(s => <ServerCard key={s.id} s={s} now={now} cores={cores} />)}
        </div>
      ) : (
        <Card>
          <Empty
            icon={<ServerIcon2 />}
            title={isAdmin ? 'No servers yet' : 'No servers shared with you'}
            action={isAdmin && <Link to="/settings"><Button variant="primary" icon={<Plus />}>Add your first server</Button></Link>}
          >
            {isAdmin ? 'Point SquidPanel at a server folder (the one with the server jar or run.sh) and it takes care of the rest.' : 'Ask the owner or an admin to give your account access to a server.'}
          </Empty>
        </Card>
      )}
    </div>
  )
}
