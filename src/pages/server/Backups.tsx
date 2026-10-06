import { useEffect, useState } from 'react'
import { Archive, CalendarClock, Download, HardDrive, Loader2, MoreHorizontal, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, q, type BackupSettings } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { ago, bytes, dateTime } from '@/lib/format'
import { Badge, Button, Card, CardHeader, Dialog, Empty, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Select, Skeleton, ToggleRow, errorToast, useConfirm } from '@/components/ui'
import { useServer } from './Layout'

interface Backup { source: string; sourceLabel: string; file: string; size: number; created: number; kind: string; note: string; actor: string }

export default function Backups() {
  const { server, reload: reloadServer } = useServer()
  const job = server.runtime.job
  const { data, loading, reload } = useApi<{ backups: Backup[]; diskFree: number | null; schedule: BackupSettings }>(`/servers/${server.id}/backups`)
  const [createOpen, setCreateOpen] = useState(false)
  const [note, setNote] = useState('')
  const [sched, setSched] = useState<BackupSettings>(server.backup)
  const [savingSched, setSavingSched] = useState(false)
  const confirm = useConfirm()
  const canSchedule = server.access.perms.includes('settings.edit')

  useEffect(() => { if (!job || job.status !== 'running') reload(true) }, [job?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    try { await api.post(`/servers/${server.id}/backups`, { note }); toast.success('Backup started'); setCreateOpen(false); setNote('') } catch (e) { errorToast(e) }
  }
  const restore = async (b: Backup) => {
    if (server.runtime.pid) return toast.error('Stop the server before restoring a backup')
    if (!(await confirm({ title: 'Restore this backup?', body: <>The server files are replaced with the backup from <b>{dateTime(b.created)}</b>. Current world folders are moved to the panel trash first, so nothing is lost.</>, confirmText: 'Restore', tone: 'danger' }))) return
    try { await api.post(`/servers/${server.id}/backups/restore`, { source: b.source, file: b.file }); toast.success('Restore started') } catch (e) { errorToast(e) }
  }
  const remove = async (b: Backup) => {
    if (!(await confirm({ title: 'Delete this backup?', body: `${b.file} (${bytes(b.size)}) will be permanently deleted.`, confirmText: 'Delete', tone: 'danger' }))) return
    try { await api.del(`/servers/${server.id}/backups${q({ source: b.source, file: b.file })}`); reload(true) } catch (e) { errorToast(e) }
  }
  const saveSchedule = async () => {
    setSavingSched(true)
    try { await api.patch(`/servers/${server.id}`, { backup: sched }); toast.success('Backup schedule saved'); reloadServer() } catch (e) { errorToast(e) } finally { setSavingSched(false) }
  }
  const running = job?.status === 'running'
  const total = (data?.backups || []).reduce((n, b) => n + b.size, 0)

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader title="Backups" description={data ? `${data.backups.length} backups · ${bytes(total)}` : undefined} icon={<Archive />}
          actions={<Button variant="primary" icon={running ? <Loader2 className="animate-spin" /> : <Plus />} disabled={running} onClick={() => setCreateOpen(true)}>{running ? job!.step : 'Create backup'}</Button>} />
        {loading && !data ? <div className="space-y-2 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14" />)}</div> : data?.backups.length ? (
          <div className="divide-y divide-line">
            {data.backups.map(b => (
              <div key={b.source + b.file} className="flex items-center gap-3.5 px-5 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-overlay text-muted"><Archive className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{dateTime(b.created)}</span>
                    <Badge tone={b.kind === 'auto' ? 'info' : 'neutral'}>{b.kind === 'auto' ? 'automatic' : 'manual'}</Badge>
                    {b.source !== 'panel' && <Badge tone="warn">{b.sourceLabel}</Badge>}
                  </div>
                  <div className="truncate text-xs text-faint">{b.note || b.file}{b.actor && b.actor !== 'system' ? ` · by ${b.actor}` : ''} · {ago(b.created)}</div>
                </div>
                <span className="hidden text-xs text-muted tabular sm:block">{bytes(b.size)}</span>
                <Menu>
                  <MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Backup actions"><MoreHorizontal /></Button></MenuTrigger>
                  <MenuContent>
                    <MenuItem icon={<RotateCcw />} disabled={running} onSelect={() => restore(b)}>Restore…</MenuItem>
                    <MenuItem icon={<Download />} onSelect={() => { window.location.href = `/api/servers/${server.id}/backups/download${q({ source: b.source, file: b.file })}` }}>Download</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} danger onSelect={() => remove(b)}>Delete</MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            ))}
          </div>
        ) : <Empty icon={<Archive />} title="No backups yet" action={<Button variant="primary" icon={<Plus />} onClick={() => setCreateOpen(true)}>Create the first backup</Button>}>Backups include worlds, configs, mods and plugins. Heavy folders like libraries and logs are skipped.</Empty>}
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Automatic backups" icon={<CalendarClock />} />
          <div className="px-5 pb-4">
            <ToggleRow title="Enabled" description="Back up on a schedule while SquidPanel runs." checked={sched.enabled} disabled={!canSchedule} onChange={v => setSched({ ...sched, enabled: v })} />
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label="Every">
                <Select value={String(sched.everyHours)} disabled={!canSchedule || !sched.enabled} onChange={v => setSched({ ...sched, everyHours: Number(v) })}
                  options={[1, 3, 6, 12, 24, 48, 168].map(h => ({ value: String(h), label: h < 24 ? `${h} hour${h > 1 ? 's' : ''}` : h === 24 ? 'day' : h === 168 ? 'week' : `${h / 24} days` }))} />
              </Field>
              <Field label="Keep last">
                <Select value={String(sched.keep)} disabled={!canSchedule || !sched.enabled} onChange={v => setSched({ ...sched, keep: Number(v) })}
                  options={[2, 3, 5, 7, 10, 14, 30].map(n => ({ value: String(n), label: `${n} backups` }))} />
              </Field>
            </div>
            <ToggleRow title="Skip if unused" description="Don't make a new backup if the server hasn't run since the last one." checked={sched.onlyWhenUsed} disabled={!canSchedule || !sched.enabled} onChange={v => setSched({ ...sched, onlyWhenUsed: v })} />
            {sched.lastAuto && <p className="pb-2 text-xs text-faint">Last automatic backup {ago(sched.lastAuto)}</p>}
            {canSchedule ? <Button className="w-full" loading={savingSched} onClick={saveSchedule}>Save schedule</Button> : <p className="text-xs text-faint">You need the settings permission to change the schedule.</p>}
          </div>
        </Card>
        {data?.diskFree != null && (
          <Card className="flex items-center gap-3 p-4">
            <HardDrive className="size-5 text-muted" />
            <div className="text-[13px]"><div className="font-medium">{bytes(data.diskFree)} free</div><div className="text-xs text-faint">on the backup disk</div></div>
          </Card>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="Create a backup" icon={<Archive />}
        description={server.runtime.pid ? 'The world is saved first and autosave is paused while the backup runs, so it is consistent.' : 'The server is offline, so the backup is a clean snapshot.'}
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" onClick={create}>Start backup</Button></>}>
        <Field label="Note" hint="optional"><Input data-autofocus value={note} onChange={e => setNote(e.target.value)} placeholder="Before installing Create 6.0" onKeyDown={e => e.key === 'Enter' && create()} /></Field>
      </Dialog>
    </div>
  )
}
