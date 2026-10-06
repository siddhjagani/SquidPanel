import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Activity as ActivityIcon, Search } from 'lucide-react'
import { q, type Activity } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { useActivityFeed } from '@/lib/live'
import { useServers } from '@/lib/servers'
import { cn } from '@/lib/format'
import { Card, Empty, Input, PageHeader, Select, Skeleton } from '@/components/ui'
import { ServerIcon, UserAvatar, actionMeta } from '@/components/domain'

function dayLabel(ts: number) {
  const d = new Date(ts), today = new Date()
  const y = new Date(); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function ActivityPage() {
  const [params, setParams] = useSearchParams()
  const server = params.get('server') || ''
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const { servers } = useServers()
  const { data, loading, setData } = useApi<{ activity: Activity[] }>(`/activity${q({ server, limit: 500 })}`)

  useActivityFeed(useCallback((a: Activity) => {
    if (server && a.serverId !== server) return
    setData(d => d && { activity: [a, ...d.activity] })
  }, [server, setData]))

  const list = useMemo(() => (data?.activity || []).filter(a =>
    (!category || a.action.startsWith(category)) &&
    (!search || `${a.actor} ${a.action} ${a.detail}`.toLowerCase().includes(search.toLowerCase()))), [data, category, search])

  const groups = useMemo(() => {
    const out: { day: string; items: Activity[] }[] = []
    for (const a of list) {
      const day = dayLabel(a.ts)
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, items: [] })
      out[out.length - 1].items.push(a)
    }
    return out
  }, [list])

  return (
    <div className="mx-auto max-w-[960px] px-5 py-7 lg:px-8">
      <PageHeader title="Activity" description="Everything that happened, who did it, and when — updated live." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="min-w-0 flex-1" icon={<Search />} placeholder="Search actions, people, commands…" value={search} onChange={e => setSearch(e.target.value)} />
        <Select className="w-44" value={server} onChange={v => setParams(v ? { server: v } : {})} options={[{ value: '', label: 'All servers' }, ...servers.map(s => ({ value: s.id, label: s.name }))]} />
        <Select className="w-40" value={category} onChange={setCategory} options={[
          { value: '', label: 'All activity' }, { value: 'server.', label: 'Power & server' }, { value: 'console.', label: 'Console commands' },
          { value: 'player.', label: 'Player moderation' }, { value: 'backup.', label: 'Backups' }, { value: 'file.', label: 'Files' }, { value: 'addon.', label: 'Mods & plugins' },
          { value: 'user.', label: 'Accounts' }, { value: 'access.', label: 'Access changes' }, { value: 'account.', label: 'Sign-ins' },
        ]} />
      </div>
      {loading && !data ? <Card className="space-y-2 p-4">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10" />)}</Card> : groups.length ? (
        <div className="space-y-6">
          {groups.map(g => (
            <div key={g.day}>
              <div className="mb-2 px-1 text-xs font-semibold text-faint">{g.day}</div>
              <Card className="divide-y divide-line">
                {g.items.map(a => {
                  const m = actionMeta(a.action)
                  const s = servers.find(x => x.id === a.serverId)
                  return (
                    <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                      {a.actor === 'system' ? <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-overlay text-muted [&_svg]:size-3.5">{m.icon}</div> : <UserAvatar name={a.actor} size={28} />}
                      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
                        <span className="font-medium">{a.actor === 'system' ? 'SquidPanel' : a.actor}</span>{' '}
                        <span className={cn('text-muted', m.tone)}>{m.text}</span>{' '}
                        {a.detail && <span className={cn('break-words', a.action === 'console.command' ? 'rounded bg-overlay px-1.5 py-0.5 font-mono text-xs' : 'text-fg/85')}>{a.detail}</span>}
                        {s && !server && <span className="ml-1.5 inline-flex translate-y-[3px] items-center gap-1 text-xs text-faint"><ServerIcon server={s} size={14} />{s.name}</span>}
                      </div>
                      <span className="shrink-0 pt-0.5 text-xs text-faint tabular">{new Date(a.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )
                })}
              </Card>
            </div>
          ))}
        </div>
      ) : <Card><Empty icon={<ActivityIcon />} title="No activity">{search || category ? 'Nothing matches these filters.' : 'Actions will appear here as people use the panel.'}</Empty></Card>}
    </div>
  )
}
