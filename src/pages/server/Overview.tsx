import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity as ActivityIcon, ArrowRight, Clock, Cpu, MemoryStick, Moon, Network, Users } from 'lucide-react'
import { api, joinAddress, q, type Activity } from '@/lib/api'
import { useLive } from '@/lib/live'
import { useApi, useNow } from '@/lib/hooks'
import { ago, cn, duration, mb } from '@/lib/format'
import { Card, CardHeader, CopyButton, Empty, Progress, Stat } from '@/components/ui'
import { PlayerHead, actionMeta } from '@/components/domain'
import { useServer } from './Layout'

interface Point { t: number; cpu: number; mem: number; players: number }

function Chart({ data, dataKey, color, unit, max }: { data: Point[]; dataKey: keyof Point; color: string; unit: string; max?: number }) {
  const id = `g-${String(dataKey)}`
  return (
    <ResponsiveContainer width="100%" height={150}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} tick={{ fill: 'rgb(var(--faint))', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis domain={[0, max ?? 'auto']} allowDecimals={false} tick={{ fill: 'rgb(var(--faint))', fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          contentStyle={{ background: 'rgb(var(--raised))', border: '1px solid rgb(var(--line-strong))', borderRadius: 10, fontSize: 12 }}
          labelFormatter={t => new Date(Number(t)).toLocaleTimeString()}
          formatter={v => [`${Math.round(Number(v))}${unit}`, '']}
          separator=""
        />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default function Overview() {
  const { server } = useServer()
  const rt = server.runtime
  const { host } = useLive()
  const cores = host?.cores || navigator.hardwareConcurrency || 8
  const now = useNow(1000)
  const [points, setPoints] = useState<Point[]>([])
  const activity = useApi<{ activity: Activity[] }>(`/activity${q({ server: server.id, limit: 8 })}`)

  useEffect(() => {
    api.get<{ stats: Point[] }>(`/servers/${server.id}/stats`).then(r => setPoints(r.stats)).catch(() => {})
  }, [server.id])
  // Append live samples (the WebSocket pushes every 2s; keep one point per ~5s).
  useEffect(() => {
    if (!rt.pid) return
    // Syncing samples pushed over the WebSocket into the local chart buffer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPoints(p => {
      const last = p[p.length - 1]
      if (last && Date.now() - last.t < 4500) return p
      return [...p.slice(-719), { t: Date.now(), cpu: rt.cpu, mem: rt.memMb, players: rt.players.length }]
    })
  }, [rt.cpu, rt.memMb, rt.players.length, rt.pid])

  const chartData = useMemo(() => points.slice(-180).map(p => ({ ...p, cpu: p.cpu / cores })), [points, cores])
  const running = !!rt.pid
  const idleLeft = rt.idle.enabled && rt.idle.since && !rt.players.length && rt.status === 'online' ? rt.idle.minutes * 60000 - (now - rt.idle.since) : null
  const address = joinAddress(server) || `localhost:${rt.port}`
  const tunnels = rt.tunnels || []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Uptime" icon={<Clock />} value={running && rt.startedAt ? duration(now - rt.startedAt) : '—'}
          sub={idleLeft != null ? <span className="flex items-center gap-1 text-muted"><Moon className="size-3" />sleeps in {duration(Math.max(0, idleLeft))}</span> : rt.idle.enabled ? `auto-sleep after ${rt.idle.minutes}m empty` : 'auto-sleep off'} />
        <Stat label="Players" icon={<Users />} value={running ? <>{rt.players.length}<span className="text-base text-faint">/{rt.maxPlayers}</span></> : '—'} sub={running ? 'online now' : 'server offline'} />
        <Stat label="CPU" icon={<Cpu />} value={running ? `${Math.round(rt.cpu / cores)}%` : '—'} sub={running ? `${Math.round(rt.cpu)}% of one core` : `${cores} cores available`}>
          {running && <Progress value={rt.cpu / cores} className="mt-3" />}
        </Stat>
        <Stat label="Memory" icon={<MemoryStick />} value={running ? mb(rt.memMb) : '—'} sub={`limit ${mb(rt.memLimitMb)}`}>
          {running && <Progress value={(rt.memMb / rt.memLimitMb) * 100} className="mt-3" tone={rt.memMb > rt.memLimitMb * 1.1 ? 'warn' : 'ok'} />}
        </Stat>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Performance" description="Last 15 minutes of CPU and memory usage" icon={<ActivityIcon />} />
            {chartData.length > 1 ? (
              <div className="grid gap-2 p-4 md:grid-cols-2">
                <div><div className="mb-1 px-2 text-xs text-muted">CPU %</div><Chart data={chartData} dataKey="cpu" color="rgb(132,116,255)" unit="%" max={100} /></div>
                <div><div className="mb-1 px-2 text-xs text-muted">Memory MB</div><Chart data={chartData} dataKey="mem" color="rgb(52,211,153)" unit=" MB" /></div>
              </div>
            ) : (
              <Empty icon={<ActivityIcon />} title={running ? 'Collecting data…' : 'Server is offline'}>{running ? 'Charts appear after a few seconds.' : 'Start the server to see live performance.'}</Empty>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent activity" icon={<Clock />} actions={<Link to={`/activity?server=${server.id}`} className="flex items-center gap-1 text-xs text-muted hover:text-fg">View all<ArrowRight className="size-3" /></Link>} />
            <div className="divide-y divide-line">
              {activity.data?.activity.length ? activity.data.activity.map(a => {
                const m = actionMeta(a.action)
                return (
                  <div key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                    <span className={cn('text-faint [&_svg]:size-4', m.tone)}>{m.icon}</span>
                    <span className="min-w-0 flex-1 truncate"><span className="font-medium">{a.actor}</span> <span className="text-muted">{m.text}</span> {a.detail && <span className="font-mono text-xs text-fg/80">{a.detail}</span>}</span>
                    <span className="shrink-0 text-xs text-faint">{ago(a.ts)}</span>
                  </div>
                )
              }) : <div className="px-5 py-6 text-center text-[13px] text-faint">Nothing yet.</div>}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Online now" icon={<Users />} actions={server.access.perms.includes('players.view') && <Link to="players" className="text-xs text-muted hover:text-fg">All players</Link>} />
            <div className="p-2">
              {rt.players.length ? rt.players.map(n => (
                <div key={n} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-overlay/50">
                  <PlayerHead name={n} size={28} />
                  <span className="flex-1 truncate text-[13px] font-medium">{n}</span>
                  <span className="size-1.5 rounded-full bg-ok" />
                </div>
              )) : <div className="px-3 py-6 text-center text-[13px] text-faint">{running ? 'Nobody is playing right now.' : 'Server is offline.'}</div>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Connect" icon={<Network />} />
            <div className="space-y-3 p-5 text-[13px]">
              <div>
                <div className="mb-1 text-xs text-faint">Server address</div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line-strong/60 bg-bg/60 py-1.5 pl-3 pr-1.5">
                  <span className="truncate font-mono text-sm">{address}</span><CopyButton value={address} />
                </div>
              </div>
              {tunnels.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs text-faint">playit tunnels</div>
                  {tunnels.map(t => (
                    <div key={t.address} className="flex items-center gap-2 text-xs">
                      <span className={cn('size-1.5 shrink-0 rounded-full', t.active ? 'bg-ok' : 'bg-faint')} title={t.active ? 'Tunnel on' : 'Tunnel off (turns on when the server starts)'} />
                      <span className="w-14 shrink-0 text-muted">{t.type === 'minecraft-bedrock' ? 'Bedrock' : 'Java'}</span>
                      <span className="min-w-0 flex-1 truncate font-mono">{t.address}</span>
                      <CopyButton value={t.address} />
                    </div>
                  ))}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 pt-1">
                <dt className="text-faint">Version</dt><dd className="text-right">{server.software} {server.mcVersion}</dd>
                <dt className="text-faint">Local port</dt><dd className="text-right font-mono">{rt.port}</dd>
                <dt className="text-faint">Console</dt><dd className="text-right">{rt.console === 'stdin' ? 'Full control' : rt.console === 'rcon' ? 'RCON' : running ? 'Read only' : '—'}</dd>
                {rt.pid && <><dt className="text-faint">Process</dt><dd className="text-right font-mono">{rt.pid}</dd></>}
              </dl>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
