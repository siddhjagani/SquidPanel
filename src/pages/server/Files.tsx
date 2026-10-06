import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useSearchParams } from 'react-router'
import {
  ChevronRight, Download, File, FileArchive, FileCode2, FileCog, FileImage, FileText, Folder, FolderPlus, FilePlus2, Home, Link2, MoreHorizontal,
  Pencil, RefreshCw, Save, Search, Trash2, Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, q } from '@/lib/api'
import { useApi } from '@/lib/hooks'
import { ago, bytes, cn } from '@/lib/format'
import { Button, Card, Dialog, Empty, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Progress, Skeleton, Spinner, errorToast, useConfirm } from '@/components/ui'
import { useServer } from './Layout'

interface Item { name: string; dir: boolean; size: number | null; modified: number; link: boolean }

const TEXT_EXT = /\.(txt|properties|json|json5|ya?ml|toml|cfg|conf|ini|log|md|sh|bat|cmd|mcmeta|js|ts|zs|snbt|csv|xml|html|css|lang|secret|env|list)$/i
function fileIcon(name: string, dir: boolean) {
  if (dir) return <Folder className="text-[#8ab4ff]" />
  if (/\.(zip|jar|gz|tar|7z|mrpack)$/i.test(name)) return <FileArchive className="text-warn/80" />
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return <FileImage className="text-ok/80" />
  if (/\.(properties|toml|ya?ml|cfg|conf|ini)$/i.test(name)) return <FileCog className="text-[#b3a8ff]" />
  if (/\.(json|js|ts|sh|bat|zs|snbt|mcmeta)$/i.test(name)) return <FileCode2 className="text-info/80" />
  if (/\.(txt|log|md)$/i.test(name)) return <FileText className="text-muted" />
  return <File className="text-faint" />
}

export default function Files() {
  const { server } = useServer()
  const [params, setParams] = useSearchParams()
  const path = params.get('path') || ''
  const { data, loading, error, reload } = useApi<{ path: string; items: Item[] }>(`/servers/${server.id}/files${q({ path })}`)
  const [filter, setFilter] = useState('')
  const [drag, setDrag] = useState(false)
  const [upload, setUpload] = useState<number | null>(null)
  const [editor, setEditor] = useState<{ path: string; content: string; original: string; isNew?: boolean } | null>(null)
  const [loadingFile, setLoadingFile] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [nameDialog, setNameDialog] = useState<{ mode: 'folder' | 'file' | 'rename'; value: string; from?: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()

  useEffect(() => { setFilter('') }, [path])
  const join = (name: string) => (path ? `${path}/${name}` : name)
  const go = (p: string) => setParams(p ? { path: p } : {})
  const crumbs = path ? path.split('/') : []
  const items = useMemo(() => (data?.items || []).filter(i => !filter || i.name.toLowerCase().includes(filter.toLowerCase())), [data, filter])

  const open = async (it: Item) => {
    if (it.dir) return go(join(it.name))
    if (!TEXT_EXT.test(it.name) && (it.size || 0) > 200_000) return download(it)
    setLoadingFile(it.name)
    try {
      const r = await api.get<{ content: string }>(`/servers/${server.id}/files/content${q({ path: join(it.name) })}`)
      setEditor({ path: join(it.name), content: r.content, original: r.content })
    } catch (e) {
      if ((e as { status?: number }).status === 415) download(it)
      else errorToast(e)
    } finally { setLoadingFile(null) }
  }
  const download = (it: Item) => { window.location.href = `/api/servers/${server.id}/files/download${q({ path: join(it.name) })}` }

  const save = async () => {
    if (!editor) return
    setSaving(true)
    try {
      await api.put(`/servers/${server.id}/files/content`, { path: editor.path, content: editor.content })
      setEditor({ ...editor, original: editor.content, isNew: false })
      toast.success('Saved')
      reload(true)
    } catch (e) { errorToast(e) } finally { setSaving(false) }
  }

  const remove = async (it: Item) => {
    if (!(await confirm({ title: `Delete ${it.name}?`, body: it.dir ? 'The folder and everything inside it will be permanently deleted.' : 'This file will be permanently deleted.', confirmText: 'Delete', tone: 'danger', typeToConfirm: it.dir ? it.name : undefined }))) return
    try { await api.del(`/servers/${server.id}/files${q({ path: join(it.name) })}`); toast.success('Deleted'); reload(true) } catch (e) { errorToast(e) }
  }

  const submitName = async () => {
    if (!nameDialog) return
    const v = nameDialog.value.trim()
    if (!v || v.includes('/')) return toast.error('Enter a name without slashes')
    try {
      if (nameDialog.mode === 'folder') await api.post(`/servers/${server.id}/files/mkdir`, { path: join(v) })
      else if (nameDialog.mode === 'rename') await api.post(`/servers/${server.id}/files/rename`, { from: join(nameDialog.from!), to: join(v) })
      else { setEditor({ path: join(v), content: '', original: '\u0000', isNew: true }); setNameDialog(null); return }
      setNameDialog(null)
      reload(true)
    } catch (e) { errorToast(e) }
  }

  const doUpload = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    const form = new FormData()
    list.forEach(f => form.append('files', f))
    setUpload(0)
    try {
      await api.upload(`/servers/${server.id}/files/upload${q({ path })}`, form, setUpload)
      toast.success(`Uploaded ${list.length} file${list.length > 1 ? 's' : ''}`)
      reload(true)
    } catch (e) { errorToast(e) } finally { setUpload(null) }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files) }

  const dirty = editor && editor.content !== editor.original
  return (
    <Card className="relative overflow-hidden" onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={e => { if (e.currentTarget === e.target) setDrag(false) }} onDrop={onDrop}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-[13px]">
          <button onClick={() => go('')} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted hover:bg-overlay hover:text-fg"><Home className="size-3.5" />{server.name}</button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-0.5">
              <ChevronRight className="size-3.5 text-faint" />
              <button onClick={() => go(crumbs.slice(0, i + 1).join('/'))} className={cn('rounded-md px-1.5 py-1 hover:bg-overlay', i === crumbs.length - 1 ? 'font-medium text-fg' : 'text-muted hover:text-fg')}>{c}</button>
            </span>
          ))}
        </nav>
        <Input className="w-full sm:w-48" icon={<Search />} placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
        <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => reload()} aria-label="Refresh" />
        <Button size="sm" icon={<FolderPlus />} onClick={() => setNameDialog({ mode: 'folder', value: '' })}>Folder</Button>
        <Button size="sm" icon={<FilePlus2 />} onClick={() => setNameDialog({ mode: 'file', value: '' })}>File</Button>
        <Button size="sm" variant="primary" icon={<Upload />} onClick={() => fileInput.current?.click()}>Upload</Button>
        <input ref={fileInput} type="file" multiple hidden onChange={e => { if (e.target.files) doUpload(e.target.files); e.target.value = '' }} />
      </div>
      {upload !== null && <div className="border-b border-line px-4 py-2"><div className="mb-1 flex justify-between text-xs text-muted"><span>Uploading…</span><span>{upload}%</span></div><Progress value={upload} /></div>}

      {loading && !data ? (
        <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9" />)}</div>
      ) : error ? (
        <Empty icon={<Folder />} title="Can't open this folder" action={<Button onClick={() => go('')}>Back to root</Button>}>{error}</Empty>
      ) : items.length ? (
        <div className="divide-y divide-line">
          {path && (
            <button onClick={() => go(crumbs.slice(0, -1).join('/'))} className="flex w-full items-center gap-3 px-5 py-2 text-left text-[13px] text-muted hover:bg-overlay/30">
              <Folder className="size-4 text-faint" />..
            </button>
          )}
          {items.map(it => (
            <div key={it.name} className="group flex items-center gap-3 px-5 py-2 text-[13px] hover:bg-overlay/30">
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left [&_svg]:size-4 [&_svg]:shrink-0" onClick={() => open(it)}>
                {loadingFile === it.name ? <Spinner /> : fileIcon(it.name, it.dir)}
                <span className="truncate">{it.name}</span>
                {it.link && <Link2 className="!size-3 text-faint" />}
              </button>
              <span className="hidden w-24 text-right text-xs text-faint tabular sm:block">{it.dir ? '' : bytes(it.size)}</span>
              <span className="hidden w-24 text-right text-xs text-faint md:block">{ago(it.modified)}</span>
              <Menu>
                <MenuTrigger asChild><Button size="icon-sm" variant="ghost" className="opacity-60 group-hover:opacity-100" aria-label="File actions"><MoreHorizontal /></Button></MenuTrigger>
                <MenuContent>
                  {!it.dir && <MenuItem icon={<Pencil />} onSelect={() => open(it)}>Open / edit</MenuItem>}
                  <MenuItem icon={<Download />} onSelect={() => download(it)}>{it.dir ? 'Download as zip' : 'Download'}</MenuItem>
                  <MenuItem icon={<FileText />} onSelect={() => setNameDialog({ mode: 'rename', value: it.name, from: it.name })}>Rename</MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 />} danger onSelect={() => remove(it)}>Delete</MenuItem>
                </MenuContent>
              </Menu>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={<Folder />} title={filter ? 'No matches' : 'This folder is empty'}>Drop files here to upload them.</Empty>
      )}

      {drag && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand bg-bg/85 text-sm font-medium">
          <Upload className="size-6 text-brand" />Drop to upload into /{path}
        </div>
      )}

      <Dialog open={!!nameDialog} onOpenChange={v => !v && setNameDialog(null)} size="sm"
        title={nameDialog?.mode === 'folder' ? 'New folder' : nameDialog?.mode === 'file' ? 'New file' : 'Rename'}
        footer={<><Button variant="ghost" onClick={() => setNameDialog(null)}>Cancel</Button><Button variant="primary" onClick={submitName}>{nameDialog?.mode === 'rename' ? 'Rename' : 'Create'}</Button></>}>
        <Field label="Name"><Input data-autofocus value={nameDialog?.value || ''} onChange={e => setNameDialog(d => d && { ...d, value: e.target.value })} onKeyDown={e => e.key === 'Enter' && submitName()} /></Field>
      </Dialog>

      <Dialog
        open={!!editor}
        onOpenChange={async v => { if (!v) { if (dirty && !(await confirm({ title: 'Discard unsaved changes?', confirmText: 'Discard', tone: 'danger' }))) return; setEditor(null) } }}
        size="full"
        title={<span className="font-mono text-sm">{editor?.path}</span>}
        description={dirty ? 'Unsaved changes — press ⌘S to save' : editor?.isNew ? 'New file' : 'Saved'}
        footer={<><span className="mr-auto text-xs text-faint">{editor?.content.split('\n').length} lines</span><Button variant="ghost" onClick={() => setEditor(null)}>Close</Button><Button variant="primary" icon={<Save />} loading={saving} disabled={!dirty} onClick={save}>Save</Button></>}
      >
        {editor && (
          <textarea
            data-autofocus
            value={editor.content}
            spellCheck={false}
            onChange={e => setEditor({ ...editor, content: e.target.value })}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save() }
              if (e.key === 'Tab') {
                e.preventDefault()
                const t = e.currentTarget, s = t.selectionStart
                const v = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd)
                setEditor({ ...editor, content: v })
                requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2 })
              }
            }}
            className="scrollbar-thin h-[62vh] w-full resize-none rounded-lg border border-line bg-[#06070a] p-4 font-mono text-[12.5px] leading-relaxed text-fg focus:border-brand/60 focus:outline-none"
          />
        )}
      </Dialog>
    </Card>
  )
}
