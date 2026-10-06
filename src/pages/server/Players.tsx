import { useMemo, useState } from 'react'
import { Ban, Crown, History, MoreHorizontal, RefreshCw, Search, Shield, ShieldCheck, ShieldOff, UserMinus, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useApi, useNow } from '@/lib/hooks'
import { ago, cn, dateTime, duration } from '@/lib/format'
import { Badge, Button, Card, CardHeader, Dialog, Empty, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Skeleton, Switch, errorToast, useConfirm } from '@/components/ui'
import { PlayerHead } from '@/components/domain'
import { useServer } from './Layout'

interface HistoryEntry { name: string; uuid: string | null; firstSeen: number; lastLogin: number | null; lastLogout: number | null; logins: number; playtimeMs: number; online: boolean; sessions: { in: number; out: number | null }[] }
interface ListEntry { name: string; uuid?: string; level?: number; reason?: string; source?: string; created?: string; ip?: string }
interface PlayersData {
  online: { name: string; since: number }[]
  history: HistoryEntry[]
  lists: { ops: ListEntry[]; whitelist: ListEntry[]; bans: ListEntry[]; ipBans: ListEntry[]; whitelistEnabled: boolean }
  canCommand: boolean
}

export default function Players() {
  const { server } = useServer()
  const { data, loading, reload } = useApi<PlayersData>(`/servers/${server.id}/players`, [server.runtime.players.join(',')])
  const [tab, setTab] = useState<'history' | 'ops' | 'whitelist' | 'bans'>('history')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<HistoryEntry | null>(null)
  const [addOpen, setAddOpen] = useState<null | 'whitelist-add' | 'op' | 'ban'>(null)
  const [addName, setAddName] = useState('')
  const [reason, setReason] = useState('')
  const confirm = useConfirm()
  const now = useNow(30000)
  const manage = server.access.perms.includes('players.manage')
  const operator = server.access.console >= 3
  const canCommand = !!data?.canCommand

  const act = async (action: string, name?: string, why?: string) => {
    try {
      await api.post(`/servers/${server.id}/players/action`, { action, name, reason: why })
      toast.success('Command sent')
      setTimeout(() => reload(true), 900)
    } catch (e) { errorToast(e) }
  }
  const kick = async (name: string) => { if (await confirm({ title: `Kick ${name}?`, confirmText: 'Kick' })) act('kick', name) }
  const ban = async (name: string) => { if (await confirm({ title: `Ban ${name}?`, body: 'They will not be able to join until unbanned.', confirmText: 'Ban', tone: 'danger' })) act('ban', name) }

  const history = useMemo(() => (data?.history || []).filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase())), [data, search])
  const totalPlay = (data?.history || []).reduce((n, p) => n + p.playtimeMs, 0)

  const rowMenu = (name: string, online: boolean) => manage && canCommand && (
    <Menu>
      <MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Player actions"><MoreHorizontal /></Button></MenuTrigger>
      <MenuContent>
        {online && <MenuItem icon={<UserMinus />} onSelect={() => kick(name)}>Kick</MenuItem>}
        <MenuItem icon={<UserPlus />} onSelect={() => act('whitelist-add', name)}>Add to whitelist</MenuItem>
        {operator && <MenuItem icon={<Crown />} onSelect={() => act('op', name)}>Make operator</MenuItem>}
        {operator && <MenuItem icon={<ShieldOff />} onSelect={() => act('deop', name)}>Remove operator</MenuItem>}
        <MenuSeparator />
        <MenuItem icon={<Ban />} danger onSelect={() => ban(name)}>Ban</MenuItem>
      </MenuContent>
    </Menu>
  )

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title={`Online now · ${data?.online.length ?? 0}`} icon={<Users />}
            actions={canCommand && <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => act('list')}>Sync</Button>} />
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            {loading && !data ? [0, 1].map(i => <Skeleton key={i} className="h-14" />) : data?.online.length ? data.online.map(p => (
              <div key={p.name} className="flex items-center gap-3 rounded-xl border border-line bg-raised/50 px-3 py-2.5">
                <PlayerHead name={p.name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-faint">playing for {duration(now - p.since)}</div>
                </div>
                {rowMenu(p.name, true)}
              </div>
            )) : <div className="col-span-full py-8 text-center text-[13px] text-faint">{server.runtime.pid ? 'Nobody online right now.' : 'Server is offline.'}</div>}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-medium text-muted">All-time</div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div><div className="text-2xl font-semibold tabular">{data?.history.length ?? '—'}</div><div className="text-xs text-faint">unique players</div></div>
            <div><div className="text-2xl font-semibold tabular">{data ? duration(totalPlay) : '—'}</div><div className="text-xs text-faint">total playtime</div></div>
          </div>
          {data && (
            <div className="mt-5 flex items-center justify-between rounded-lg border border-line bg-raised/50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-[13px]"><Shield className="size-4 text-muted" />Whitelist</div>
              <Switch size="sm" checked={data.lists.whitelistEnabled} disabled={!manage || !canCommand} onChange={v => act(v ? 'whitelist-on' : 'whitelist-off')} />
            </div>
          )}
          {!canCommand && <p className="mt-3 text-xs leading-relaxed text-faint">Player actions need a running server with console access.</p>}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented value={tab} onChange={setTab} options={[
            { value: 'history', label: 'History' },
            { value: 'ops', label: `Operators${data ? ` · ${data.lists.ops.length}` : ''}` },
            { value: 'whitelist', label: `Whitelist${data ? ` · ${data.lists.whitelist.length}` : ''}` },
            { value: 'bans', label: `Bans${data ? ` · ${data.lists.bans.length + data.lists.ipBans.length}` : ''}` },
          ]} />
          {tab === 'history' && <Input className="ml-auto w-full sm:w-60" icon={<Search />} placeholder="Search players" value={search} onChange={e => setSearch(e.target.value)} />}
          {tab !== 'history' && manage && canCommand && (tab !== 'ops' || operator) && (
            <Button size="sm" className="ml-auto" icon={<UserPlus />} onClick={() => { setAddName(''); setReason(''); setAddOpen(tab === 'ops' ? 'op' : tab === 'bans' ? 'ban' : 'whitelist-add') }}>
              {tab === 'ops' ? 'Add operator' : tab === 'bans' ? 'Ban player' : 'Add player'}
            </Button>
          )}
        </div>

        {tab === 'history' && (history.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-faint">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5 font-medium">Player</th>
                  <th className="px-3 py-2.5 font-medium">Last seen</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">First joined</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sessions</th>
                  <th className="px-3 py-2.5 text-right font-medium">Playtime</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map(p => (
                  <tr key={p.name} className="cursor-pointer hover:bg-overlay/30" onClick={() => setDetail(p)}>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-3">
                        <PlayerHead name={p.name} size={26} />
                        <span className="font-medium">{p.name}</span>
                        {p.online && <Badge tone="ok">online</Badge>}
                        {data?.lists.ops.some(o => o.name === p.name) && <Crown className="size-3.5 text-warn" />}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{p.online ? <span className="text-ok">now</span> : ago(p.lastLogout || p.lastLogin)}</td>
                    <td className="hidden px-3 py-2.5 text-muted md:table-cell">{dateTime(p.firstSeen)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{p.logins}</td>
                    <td className="px-3 py-2.5 text-right tabular">{duration(p.playtimeMs)}</td>
                    <td className="px-3" onClick={e => e.stopPropagation()}>{rowMenu(p.name, p.online)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={<History />} title="No players yet">Joins and leaves are recorded automatically while SquidPanel is running.</Empty>)}

        {tab !== 'history' && data && (() => {
          const list = tab === 'ops' ? data.lists.ops : tab === 'whitelist' ? data.lists.whitelist : [...data.lists.bans, ...data.lists.ipBans.map(b => ({ ...b, name: b.ip || '?' }))]
          if (!list.length) return <Empty icon={tab === 'bans' ? <Ban /> : tab === 'ops' ? <Crown /> : <ShieldCheck />} title={tab === 'bans' ? 'No bans' : tab === 'ops' ? 'No operators' : 'Whitelist is empty'} />
          return (
            <div className="divide-y divide-line">
              {list.map(e => (
                <div key={e.name + (e.uuid || '')} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                  {e.ip ? <div className="flex size-[26px] items-center justify-center rounded bg-overlay text-[10px] text-muted">IP</div> : <PlayerHead name={e.name} size={26} />}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{e.name}</div>
                    {e.reason && <div className="truncate text-xs text-faint">{e.reason}{e.source ? ` — by ${e.source}` : ''}</div>}
                  </div>
                  {tab === 'ops' && e.level != null && <Badge>level {e.level}</Badge>}
                  {manage && canCommand && !e.ip && (tab !== 'ops' || operator) && (
                    <Button size="xs" variant="ghost" onClick={() => act(tab === 'ops' ? 'deop' : tab === 'bans' ? 'pardon' : 'whitelist-remove', e.name)}>
                      {tab === 'ops' ? 'Remove' : tab === 'bans' ? 'Unban' : 'Remove'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )
        })()}
      </Card>

      <Dialog open={!!detail} onOpenChange={v => !v && setDetail(null)} title={detail?.name || ''} description={detail?.uuid ? <span className="font-mono text-xs">{detail.uuid}</span> : undefined}
        icon={detail && <PlayerHead name={detail.name} size={36} />}>
        {detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              {[['Sessions', String(detail.logins)], ['Playtime', duration(detail.playtimeMs)], ['First joined', ago(detail.firstSeen)]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-line bg-raised/50 p-3"><div className="text-xs text-faint">{k}</div><div className="mt-1 font-semibold">{v}</div></div>
              ))}
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-muted">Recent sessions</div>
              <div className="divide-y divide-line rounded-xl border border-line">
                {detail.sessions.length ? detail.sessions.map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-[13px]">
                    <span>{dateTime(s.in)}</span>
                    <span className={cn('tabular', s.out ? 'text-muted' : 'text-ok')}>{s.out ? duration(s.out - s.in) : 'playing now'}</span>
                  </div>
                )) : <div className="px-3 py-4 text-center text-xs text-faint">No sessions recorded.</div>}
              </div>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!addOpen} onOpenChange={v => !v && setAddOpen(null)} size="sm"
        title={addOpen === 'op' ? 'Add operator' : addOpen === 'ban' ? 'Ban a player' : 'Add to whitelist'}
        footer={<><Button variant="ghost" onClick={() => setAddOpen(null)}>Cancel</Button>
          <Button variant={addOpen === 'ban' ? 'danger' : 'primary'} disabled={!/^[.\w-]{1,24}$/.test(addName)} onClick={() => { act(addOpen!, addName, reason); setAddOpen(null) }}>Confirm</Button></>}>
        <div className="space-y-4">
          <Field label="Player name"><Input data-autofocus value={addName} onChange={e => setAddName(e.target.value)} placeholder="Notch" /></Field>
          {addOpen === 'ban' && <Field label="Reason" hint="optional"><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>}
        </div>
      </Dialog>
    </div>
  )
}
