import { useState } from 'react'
import { Coffee, Cpu, FolderSearch, Globe, HardDrive, Info, Network, Plus, RefreshCw, Save, ServerCog, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { useLive } from '@/lib/live'
import { useServers } from '@/lib/servers'
import { bytes, duration } from '@/lib/format'
import { Badge, Button, Callout, Card, CardHeader, CopyButton, Dialog, Empty, Field, Input, PageHeader, Skeleton, ToggleRow, errorToast } from '@/components/ui'
import { cn } from '@/lib/format'

interface Found { dir: string; name: string; software: string; mcVersion: string; port: number; launch: string }
interface Runtime { path: string; version: string; major: number; vendor: string; bundled: boolean }
interface Settings { scanDirs: string[]; preventSleep: boolean; publicUrl: string }
interface PlayitStatus {
  enabled: boolean; agent: 'running' | 'stopped' | 'external' | 'disabled'; pid: number | null; error: string | null; lastSync: number | null
  keyFound: boolean; binaryFound: boolean
  tunnels: { id: string; type: string; active: boolean; disabledReason: string | null; address: string | null; localPort: number | null; server: string | null }[]
}

function PlayitCard() {
  const { data, reload, setData } = useApi<PlayitStatus>('/system/playit?refresh=1')
  const toggle = async (enabled: boolean) => {
    try { await api.patch('/system/settings', { playit: { enabled } }); toast.success(enabled ? 'playit turned on' : 'playit turned off'); setTimeout(() => reload(true), 2500) } catch (e) { errorToast(e) }
  }
  const agentBadge = !data ? null : data.agent === 'running' ? <Badge tone="ok">agent running</Badge>
    : data.agent === 'external' ? <Badge tone="info">using SquidServers app's agent</Badge>
    : data.agent === 'disabled' ? <Badge>off</Badge> : <Badge tone="warn">starting…</Badge>
  return (
    <Card>
      <CardHeader title="playit.gg tunnels" description="How friends outside your network reach your servers." icon={<Network />}
        actions={<>{agentBadge}<Button size="icon-sm" variant="ghost" onClick={async () => setData(await api.get('/system/playit?refresh=1'))} aria-label="Refresh"><RefreshCw /></Button></>} />
      <div className="px-5">
        {data ? <>
          <ToggleRow title="Run playit from SquidPanel" checked={data.enabled} disabled={!data.keyFound || !data.binaryFound} onChange={toggle}
            description="Keeps the playit agent running (no SquidServers app needed) and switches each server's tunnel on when it starts and off when it stops. If the SquidServers app is already running playit, SquidPanel reuses that agent instead of starting a second one." />
          {!data.keyFound && <Callout tone="warn" className="mb-4">No playit key found. Set up playit once in the SquidServers app.</Callout>}
          {data.error && <Callout tone="bad" className="mb-4" title="playit error">{data.error}</Callout>}
        </> : <Skeleton className="my-4 h-16" />}
      </div>
      {data && data.tunnels.length > 0 && (
        <div className="divide-y divide-line border-t border-line">
          {data.tunnels.map(t => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
              <span className={cn('size-2 rounded-full', t.active ? 'bg-ok' : 'bg-faint')} title={t.active ? 'on' : 'off'} />
              <span className="w-16 text-xs text-muted">{t.type === 'minecraft-bedrock' ? 'Bedrock' : 'Java'}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{t.address || '—'}</span>
              <span className="text-xs text-faint">→ :{t.localPort} {t.server ? `(${t.server})` : ''}</span>
              {t.disabledReason ? <Badge tone="warn">{t.disabledReason}</Badge> : <Badge tone={t.active ? 'ok' : 'neutral'}>{t.active ? 'on' : 'off'}</Badge>}
              {t.address && <CopyButton value={t.address} />}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function PanelSettings() {
  const { reload: reloadServers } = useServers()
  const { host } = useLive()
  const discover = useApi<{ found: Found[]; scanDirs: string[] }>('/discover')
  const java = useApi<{ runtimes: Runtime[] }>('/system/java')
  const settings = useApi<{ settings: Settings }>('/system/settings')
  const [adding, setAdding] = useState<string | null>(null)
  const [manual, setManual] = useState<{ dir: string; name: string; address: string } | null>(null)
  const [newDir, setNewDir] = useState('')

  const add = async (body: { dir: string; name?: string; address?: string }) => {
    setAdding(body.dir)
    try {
      await api.post('/servers', body)
      toast.success(`${body.name || 'Server'} added`)
      setManual(null)
      discover.reload(true)
      reloadServers()
    } catch (e) { errorToast(e) } finally { setAdding(null) }
  }
  const saveSettings = async (patch: Partial<Settings>) => {
    try { const r = await api.patch<{ settings: Settings }>('/system/settings', patch); settings.setData({ settings: r.settings }); toast.success('Saved'); if (patch.scanDirs) discover.reload() } catch (e) { errorToast(e) }
  }
  const s = settings.data?.settings

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-7 lg:px-8">
      <PageHeader title="Panel settings" description="Servers, this Mac, and how SquidPanel runs." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Add servers" description="SquidPanel scans these folders for Minecraft servers." icon={<FolderSearch />}
            actions={<><Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => discover.reload()}>Rescan</Button><Button size="sm" icon={<Plus />} onClick={() => setManual({ dir: '', name: '', address: '' })}>Add by path</Button></>} />
          <div className="p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {(s?.scanDirs || []).map(d => (
                <span key={d} className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-overlay py-0.5 pl-2 pr-1 font-mono text-xs">
                  {d}<button onClick={() => saveSettings({ scanDirs: s!.scanDirs.filter(x => x !== d) })} className="rounded p-0.5 text-faint hover:text-bad"><X className="size-3" /></button>
                </span>
              ))}
              <Input className="w-64" placeholder="~/another/servers/folder" value={newDir} onChange={e => setNewDir(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newDir.trim() && s) { saveSettings({ scanDirs: [...s.scanDirs, newDir.trim()] }); setNewDir('') } }} />
            </div>
            {discover.loading && !discover.data ? <Skeleton className="h-16" /> : discover.data?.found.length ? (
              <div className="divide-y divide-line rounded-xl border border-line">
                {discover.data.found.map(f => (
                  <div key={f.dir} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px] font-medium">{f.name}<Badge>{f.software}</Badge>{f.mcVersion && <Badge>{f.mcVersion}</Badge>}</div>
                      <div className="truncate font-mono text-xs text-faint">{f.dir} · port {f.port}</div>
                    </div>
                    <Button size="sm" variant="primary" icon={<Plus />} loading={adding === f.dir} onClick={() => add({ dir: f.dir, name: f.name })}>Add</Button>
                  </div>
                ))}
              </div>
            ) : <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-faint">Every server in these folders is already added. Use “Add by path” for servers elsewhere.</p>}
          </div>
        </Card>

        <PlayitCard />

        <Card>
          <CardHeader title="Behaviour" icon={<Coffee />} />
          <div className="divide-y divide-line px-5">
            {s ? <>
              <ToggleRow title="Keep the Mac awake while a server runs" description="Prevents idle sleep (via caffeinate) only while at least one server is running. Your display can still turn off." checked={s.preventSleep} onChange={v => saveSettings({ preventSleep: v })} />
              <div className="py-4">
                <Field label="Public panel URL" hint="optional" help="If you expose the panel through a tunnel, note the URL here so it appears in shared login details.">
                  <div className="flex gap-2"><Input className="flex-1" defaultValue={s.publicUrl} id="publicUrl" placeholder="https://panel.example.com" /><Button icon={<Save />} onClick={() => saveSettings({ publicUrl: (document.getElementById('publicUrl') as HTMLInputElement).value })}>Save</Button></div>
                </Field>
              </div>
            </> : <Skeleton className="my-4 h-24" />}
          </div>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader title="This Mac" icon={<Cpu />} />
            {host ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 p-5 text-[13px]">
                <dt className="text-faint">Host</dt><dd className="text-right">{host.hostname}</dd>
                <dt className="text-faint">CPU</dt><dd className="truncate text-right">{host.cpuModel} · {host.cores} cores</dd>
                <dt className="text-faint">Memory</dt><dd className="text-right">{bytes(host.memTotal - host.memFree)} / {bytes(host.memTotal)}</dd>
                {host.disk && <><dt className="text-faint">Disk free</dt><dd className="text-right">{bytes(host.disk.free)} / {bytes(host.disk.total)}</dd></>}
                <dt className="text-faint">System</dt><dd className="text-right">{host.platform} · {host.arch}</dd>
                <dt className="text-faint">Uptime</dt><dd className="text-right">{duration(host.uptime * 1000, false)}</dd>
              </dl>
            ) : <Skeleton className="m-5 h-40" />}
          </Card>
          <Card>
            <CardHeader title="Java runtimes" icon={<HardDrive />} actions={<Button size="icon-sm" variant="ghost" onClick={async () => java.setData(await api.get('/system/java?refresh=1'))}><RefreshCw /></Button>} />
            <div className="divide-y divide-line">
              {java.data?.runtimes.length ? java.data.runtimes.map(r => (
                <div key={r.path} className="px-5 py-2.5">
                  <div className="flex items-center gap-2 text-[13px] font-medium">Java {r.major}<span className="font-mono text-xs font-normal text-faint">{r.version}</span>{r.bundled && <Badge tone="brand">SquidServers</Badge>}</div>
                  <div className="truncate font-mono text-2xs text-faint" title={r.path}>{r.path}</div>
                </div>
              )) : java.loading ? <Skeleton className="m-5 h-24" /> : <Empty title="No Java found">Install Temurin 21 and 25 from adoptium.net.</Empty>}
            </div>
          </Card>
        </div>

        {host && (
          <Card>
            <CardHeader title="SquidPanel service" icon={<ServerCog />} />
            <div className="grid gap-4 p-5 text-[13px] md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex justify-between"><span className="text-faint">Version</span><span>v{host.panel.version} · Node {host.panel.node}</span></div>
                <div className="flex justify-between"><span className="text-faint">Running for</span><span>{duration(host.panel.uptime * 1000, false)}</span></div>
                <div className="flex justify-between gap-4"><span className="text-faint">Data</span><span className="truncate font-mono text-xs">{host.panel.dataDir}</span></div>
              </div>
              <div className="rounded-xl border border-line bg-bg/50 p-3 text-xs leading-relaxed text-muted">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-fg"><Info className="size-3.5" />Always on</div>
                SquidPanel runs as a macOS login service: it starts when you log in and restarts itself if it ever stops. Minecraft servers keep running even while the panel restarts.
                <div className="mt-2 flex items-center gap-1.5"><Globe className="size-3.5" />Open it on this network at <span className="font-mono text-fg">http://{host.hostname}.local:{location.port || 80}</span></div>
              </div>
            </div>
          </Card>
        )}
      </div>

      <Dialog open={!!manual} onOpenChange={v => !v && setManual(null)} title="Add a server by path" icon={<Plus />} description="The folder that contains the server jar or run.sh, server.properties and eula.txt."
        footer={<><Button variant="ghost" onClick={() => setManual(null)}>Cancel</Button><Button variant="primary" disabled={!manual?.dir} loading={!!adding} onClick={() => manual && add(manual)}>Add server</Button></>}>
        {manual && (
          <div className="space-y-4">
            <Field label="Server folder"><Input data-autofocus className="font-mono" value={manual.dir} onChange={e => setManual({ ...manual, dir: e.target.value })} placeholder="~/SquidServers/MyServer" /></Field>
            <Field label="Display name" hint="optional"><Input value={manual.name} onChange={e => setManual({ ...manual, name: e.target.value })} /></Field>
            <Field label="Public address" hint="optional"><Input value={manual.address} onChange={e => setManual({ ...manual, address: e.target.value })} placeholder="example.joinmc.link" /></Field>
          </div>
        )}
      </Dialog>
    </div>
  )
}
