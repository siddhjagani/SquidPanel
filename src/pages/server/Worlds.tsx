import { useState } from 'react'
import { CheckCircle2, Download, Globe2, Info, MoreHorizontal, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { ago, bytes } from '@/lib/format'
import { Badge, Button, Callout, Card, Dialog, Empty, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Progress, Skeleton, errorToast, useConfirm } from '@/components/ui'
import { useServer } from './Layout'

interface World { name: string; folders: string[]; size: number; modified: number; active: boolean }

export default function Worlds() {
  const { server } = useServer()
  const { data, loading, reload } = useApi<{ active: string; worlds: World[]; running: boolean }>(`/servers/${server.id}/worlds`)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [pendingRestart, setPendingRestart] = useState(false)
  const confirm = useConfirm()

  const activate = async (w: World) => {
    try {
      const r = await api.post<{ restartRequired: boolean }>(`/servers/${server.id}/worlds/activate`, { name: w.name })
      toast.success(`${w.name} is now the active world`)
      if (r.restartRequired) setPendingRestart(true)
      reload(true)
    } catch (e) { errorToast(e) }
  }
  const remove = async (w: World) => {
    if (!(await confirm({ title: `Delete world “${w.name}”?`, body: `${w.folders.join(', ')} (${bytes(w.size)}) will be permanently deleted. Make a backup first if you might need it.`, confirmText: 'Delete world', tone: 'danger', typeToConfirm: w.name }))) return
    try { await api.del(`/servers/${server.id}/worlds/${encodeURIComponent(w.name)}`); toast.success('World deleted'); reload(true) } catch (e) { errorToast(e) }
  }
  const doUpload = async () => {
    if (!file) return
    const form = new FormData()
    form.append('world', file)
    form.append('name', name)
    setProgress(0)
    try { await api.upload(`/servers/${server.id}/worlds/upload`, form, setProgress); toast.success('World uploaded'); setUploadOpen(false); setFile(null); reload(true) } catch (e) { errorToast(e) } finally { setProgress(null) }
  }

  return (
    <div className="space-y-4">
      {pendingRestart && <Callout tone="warn" icon={<Info />} title="Restart to load the new world">The server keeps running the old world until its next start.</Callout>}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">The active world loads when the server starts. Nether and End folders are kept with their world.</p>
        <Button variant="primary" icon={<Upload />} onClick={() => { setName(''); setFile(null); setUploadOpen(true) }}>Upload world</Button>
      </div>
      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1].map(i => <Skeleton key={i} className="h-32" />)}</div>
      ) : data?.worlds.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.worlds.map(w => (
            <Card key={w.name} className={w.active ? 'border-ok/30' : ''}>
              <div className="flex items-start gap-3 p-5">
                <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${w.active ? 'bg-ok/12 text-ok' : 'bg-overlay text-muted'}`}><Globe2 className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate font-semibold">{w.name}</span>{w.active && <Badge tone="ok">Active</Badge>}</div>
                  <div className="mt-1 text-xs text-faint">{bytes(w.size)} · saved {ago(w.modified)}</div>
                  <div className="mt-2 flex flex-wrap gap-1">{w.folders.map(f => <span key={f} className="rounded bg-overlay px-1.5 py-px font-mono text-2xs text-muted">{f}</span>)}</div>
                </div>
                <Menu>
                  <MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="World actions"><MoreHorizontal /></Button></MenuTrigger>
                  <MenuContent>
                    {!w.active && <MenuItem icon={<CheckCircle2 />} onSelect={() => activate(w)}>Make active</MenuItem>}
                    <MenuItem icon={<Download />} onSelect={() => { window.location.href = `/api/servers/${server.id}/worlds/${encodeURIComponent(w.name)}/download` }}>Download zip</MenuItem>
                    {!w.active && <><MenuSeparator /><MenuItem icon={<Trash2 />} danger onSelect={() => remove(w)}>Delete</MenuItem></>}
                  </MenuContent>
                </Menu>
              </div>
              {!w.active && <div className="border-t border-line px-5 py-2.5"><Button size="xs" variant="ghost" icon={<CheckCircle2 />} onClick={() => activate(w)}>Use this world</Button></div>}
            </Card>
          ))}
        </div>
      ) : <Card><Empty icon={<Globe2 />} title="No worlds yet">A world is generated the first time the server starts — or upload one.</Empty></Card>}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen} title="Upload a world" description="A .zip containing a world folder (with level.dat inside)." icon={<Upload />}
        footer={<><Button variant="ghost" onClick={() => setUploadOpen(false)}>Cancel</Button><Button variant="primary" disabled={!file || !name} loading={progress !== null} onClick={doUpload}>Upload</Button></>}>
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-bg/40 px-4 py-8 text-center text-[13px] text-muted hover:border-brand/60">
            <Upload className="size-5" />
            {file ? <span className="text-fg">{file.name} · {bytes(file.size)}</span> : 'Choose a .zip file'}
            <input type="file" accept=".zip" hidden onChange={e => { const f = e.target.files?.[0] || null; setFile(f); if (f && !name) setName(f.name.replace(/\.zip$/i, '').replace(/[^\w.-]+/g, '_')) }} />
          </label>
          <Field label="Folder name" help="The world is saved under this folder in the server directory."><Input value={name} onChange={e => setName(e.target.value)} placeholder="my_world" /></Field>
          {progress !== null && <Progress value={progress} />}
        </div>
      </Dialog>
    </div>
  )
}
