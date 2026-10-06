import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Check, Download, Info, Package, Plug, Search, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api, q } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { bytes, cn } from '@/lib/format'
import { Badge, Button, Callout, Card, Empty, Input, Progress, Segmented, Skeleton, Switch, Tip, errorToast, useConfirm } from '@/components/ui'
import { useServer } from './Layout'

interface Addon { file: string; enabled: boolean; size: number; modified: number; name?: string; version?: string; description?: string; id?: string; side?: string; loader?: string }
interface AddonList { kind: 'mod' | 'plugin'; dir: string; software: string; mcVersion: string; items: Addon[]; restartNeeded: boolean }
interface Hit { project_id: string; slug: string; title: string; description: string; icon_url: string | null; downloads: number; author: string; server_side: string; client_side: string; categories: string[] }

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

function Browse({ serverId, kind, installedIds, onInstalled }: { serverId: string; kind: 'mod' | 'plugin'; installedIds: Set<string>; onInstalled: () => void }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [anyVersion, setAnyVersion] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  useEffect(() => { const t = setTimeout(() => setDebounced(query), 350); return () => clearTimeout(t) }, [query])
  const { data, loading, error } = useApi<{ hits: Hit[]; mcVersion: string; loaders: string[] }>(`/servers/${serverId}/addons/modrinth${q({ q: debounced, anyVersion: anyVersion ? 1 : undefined })}`)

  const install = async (h: Hit) => {
    setInstalling(h.project_id)
    try {
      const r = await api.post<{ installed: string[] }>(`/servers/${serverId}/addons/modrinth/install`, { projectId: h.project_id })
      toast.success(r.installed.length ? `Installed ${r.installed.join(', ')}` : 'Already installed', { description: r.installed.length > 1 ? 'Required dependencies were installed too.' : undefined })
      setDone(d => new Set(d).add(h.project_id))
      onInstalled()
    } catch (e) { errorToast(e) } finally { setInstalling(null) }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Input className="min-w-0 flex-1" icon={<Search />} placeholder={`Search Modrinth ${kind}s…`} value={query} onChange={e => setQuery(e.target.value)} />
        <label className="flex items-center gap-2 text-xs text-muted"><Switch size="sm" checked={anyVersion} onChange={setAnyVersion} />Any game version</label>
      </div>
      {data && <div className="px-5 pt-3 text-xs text-faint">Showing {kind}s for {data.loaders.join('/') || 'any loader'}{!anyVersion && data.mcVersion ? ` · Minecraft ${data.mcVersion}` : ''}</div>}
      {error ? <Empty icon={<Package />} title="Modrinth is unreachable">{error}</Empty> : loading && !data ? (
        <div className="grid gap-3 p-4 md:grid-cols-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : data?.hits.length ? (
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {data.hits.map(h => {
            const installed = done.has(h.project_id) || installedIds.has(h.slug) || installedIds.has(h.project_id)
            return (
              <div key={h.project_id} className="flex gap-3 rounded-xl border border-line bg-raised/40 p-3.5 transition-colors hover:border-line-strong">
                {h.icon_url ? <img src={h.icon_url} alt="" className="size-12 shrink-0 rounded-lg bg-overlay object-cover" loading="lazy" /> : <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-overlay"><Package className="size-5 text-faint" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <a href={`https://modrinth.com/${kind}/${h.slug}`} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold hover:underline">{h.title}</a>
                    <span className="shrink-0 text-xs text-faint">by {h.author}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{h.description}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex items-center gap-1 text-2xs text-faint"><Download className="size-3" />{compact(h.downloads)}</span>
                    {h.server_side === 'optional' && kind === 'mod' && <Badge tone="info">server optional</Badge>}
                    <Button size="xs" variant={installed ? 'ghost' : 'secondary'} className="ml-auto" loading={installing === h.project_id} disabled={installed} icon={installed ? <Check className="text-ok" /> : <Download />} onClick={() => install(h)}>
                      {installed ? 'Installed' : 'Install'}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : <Empty icon={<Search />} title="No results">Try a different search{!anyVersion ? ' or enable “Any game version”' : ''}.</Empty>}
    </div>
  )
}

export default function Addons() {
  const { server } = useServer()
  const { data, loading, reload, setData } = useApi<AddonList>(`/servers/${server.id}/addons`)
  const [tab, setTab] = useState<'installed' | 'browse'>('installed')
  const [filter, setFilter] = useState('')
  const [show, setShow] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [upload, setUpload] = useState<number | null>(null)
  const [changed, setChanged] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  const kind = data?.kind || (server.addonsDir === 'plugins' ? 'plugin' : 'mod')
  const noun = kind === 'plugin' ? 'plugin' : 'mod'

  const items = useMemo(() => (data?.items || []).filter(a =>
    (show === 'all' || (show === 'enabled' ? a.enabled : !a.enabled)) &&
    (!filter || `${a.name} ${a.file} ${a.id}`.toLowerCase().includes(filter.toLowerCase()))), [data, filter, show])
  const installedIds = useMemo(() => new Set((data?.items || []).flatMap(a => [a.id, a.name?.toLowerCase()].filter(Boolean) as string[])), [data])

  const toggle = async (a: Addon) => {
    try {
      const r = await api.post<{ file: string }>(`/servers/${server.id}/addons/toggle`, { file: a.file })
      setData(d => d && { ...d, items: d.items.map(x => x.file === a.file ? { ...x, file: r.file, enabled: !x.enabled } : x) })
      setChanged(true)
    } catch (e) { errorToast(e) }
  }
  const remove = async (a: Addon) => {
    if (!(await confirm({ title: `Remove ${a.name || a.file}?`, body: 'The jar file is deleted from the server. Its config files are kept.', confirmText: 'Remove', tone: 'danger' }))) return
    try { await api.del(`/servers/${server.id}/addons${q({ file: a.file })}`); setChanged(true); reload(true) } catch (e) { errorToast(e) }
  }
  const doUpload = async (files: FileList) => {
    const form = new FormData()
    Array.from(files).forEach(f => form.append('files', f))
    setUpload(0)
    try { const r = await api.upload<{ saved: string[] }>(`/servers/${server.id}/addons/upload`, form, setUpload); toast.success(`Added ${r.saved.length} ${noun}${r.saved.length > 1 ? 's' : ''}`); setChanged(true); reload(true) } catch (e) { errorToast(e) } finally { setUpload(null) }
  }

  const enabledCount = data?.items.filter(a => a.enabled).length ?? 0
  return (
    <div className="space-y-4">
      {changed && server.runtime.pid && <Callout tone="warn" icon={<Info />} title="Restart required">Changes to {noun}s take effect the next time the server starts.</Callout>}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented value={tab} onChange={setTab} options={[{ value: 'installed', label: `Installed${data ? ` · ${data.items.length}` : ''}` }, { value: 'browse', label: 'Browse Modrinth' }]} />
          {tab === 'installed' && <>
            <Input className="w-full sm:ml-auto sm:w-56" icon={<Search />} placeholder={`Filter ${noun}s`} value={filter} onChange={e => setFilter(e.target.value)} />
            <Segmented size="sm" value={show} onChange={setShow} options={[{ value: 'all', label: 'All' }, { value: 'enabled', label: 'On' }, { value: 'disabled', label: 'Off' }]} />
            <Button size="sm" variant="primary" icon={<Upload />} onClick={() => input.current?.click()}>Upload .jar</Button>
            <input ref={input} type="file" accept=".jar" multiple hidden onChange={e => { if (e.target.files) doUpload(e.target.files); e.target.value = '' }} />
          </>}
        </div>
        {upload !== null && <div className="border-b border-line px-4 py-2"><Progress value={upload} /></div>}

        {tab === 'browse' ? <Browse serverId={server.id} kind={kind} installedIds={installedIds} onInstalled={() => { setChanged(true); reload(true) }} /> : loading && !data ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
        ) : items.length ? (
          <>
            <div className="px-5 pt-3 text-xs text-faint">{enabledCount} of {data!.items.length} enabled · /{data!.dir}</div>
            <div className="divide-y divide-line">
              {items.map(a => (
                <div key={a.file} className={cn('flex items-center gap-3.5 px-5 py-3', !a.enabled && 'opacity-55')}>
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-overlay text-muted">{kind === 'plugin' ? <Plug className="size-4" /> : <Box className="size-4" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{a.name || a.file.replace(/\.jar(\.disabled)?$/, '')}</span>
                      {a.version && <span className="font-mono text-2xs text-faint">{a.version}</span>}
                      {a.side === 'client' && <Tip content="This mod declares itself client-only and may crash a server"><span><Badge tone="warn">client only</Badge></span></Tip>}
                    </div>
                    <div className="truncate text-xs text-faint">{a.description || a.file}</div>
                  </div>
                  <span className="hidden text-xs text-faint tabular sm:block">{bytes(a.size)}</span>
                  <Tip content={a.enabled ? 'Disable' : 'Enable'}><span><Switch size="sm" checked={a.enabled} onChange={() => toggle(a)} /></span></Tip>
                  <Button size="icon-sm" variant="ghost" onClick={() => remove(a)} aria-label="Remove"><Trash2 /></Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Empty icon={kind === 'plugin' ? <Plug /> : <Box />} title={filter || show !== 'all' ? 'No matches' : `No ${noun}s installed`}
            action={!filter && <Button variant="primary" onClick={() => setTab('browse')}>Browse Modrinth</Button>}>
            Upload .jar files or install from Modrinth with one click.
          </Empty>
        )}
      </Card>
    </div>
  )
}
