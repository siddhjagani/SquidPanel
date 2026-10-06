import { useMemo, useState } from 'react'
import { ChevronDown, Copy, Crown, KeyRound, MoreHorizontal, Pencil, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, UserPlus, UserX, Users as UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Grant, type Meta, type Role, type Server, type User } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApi } from '@/lib/hooks'
import { useServers } from '@/lib/servers'
import { ago, cn, copy, randomPassword } from '@/lib/format'
import { Badge, Button, Callout, Card, Dialog, Empty, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, PageHeader, Segmented, Select, Skeleton, errorToast, useConfirm } from '@/components/ui'
import { ConsoleBadge, GrantEditor, RoleBadge, ServerIcon, UserAvatar, grantSummary } from '@/components/domain'

type Grants = Record<string, Grant | null>

function presetOf(g: Grant | null, meta: Meta) {
  if (!g) return 'none'
  const hit = Object.entries(meta.presets).find(([, p]) => p.console === g.console && p.perms.length === g.perms.length && p.perms.every(x => g.perms.includes(x)))
  return hit ? hit[0] : 'custom'
}

// Per-server access picker used by both "create account" and "edit access".
function GrantMatrix({ servers, meta, value, onChange }: { servers: Server[]; meta: Meta; value: Grants; onChange: (g: Grants) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!servers.length) return <p className="text-[13px] text-faint">No servers have been added yet.</p>
  return (
    <div className="divide-y divide-line rounded-xl border border-line">
      {servers.map(s => {
        const g = value[s.id] || null
        const preset = presetOf(g, meta)
        return (
          <div key={s.id}>
            <div className="flex items-center gap-3 px-3 py-2.5">
              <ServerIcon server={s} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{s.name}</div>
                <div className="truncate text-xs text-faint">{grantSummary(g, meta)}</div>
              </div>
              <Select className="w-36" value={preset} onChange={v => {
                if (v === 'none') onChange({ ...value, [s.id]: null })
                else if (v === 'custom') { onChange({ ...value, [s.id]: g || { console: 1, perms: [] } }); setOpen(s.id) }
                else onChange({ ...value, [s.id]: { console: meta.presets[v].console, perms: [...meta.presets[v].perms] } })
              }} options={[{ value: 'none', label: 'No access' }, ...Object.entries(meta.presets).map(([k, p]) => ({ value: k, label: p.label })), { value: 'custom', label: 'Custom…' }]} />
              <Button size="icon-sm" variant="ghost" disabled={!g} onClick={() => setOpen(open === s.id ? null : s.id)} aria-label="Customize"><ChevronDown className={cn('transition-transform', open === s.id && 'rotate-180')} /></Button>
            </div>
            {open === s.id && g && <div className="border-t border-line bg-raised/30 p-4"><GrantEditor meta={meta} value={g} onChange={ng => onChange({ ...value, [s.id]: ng })} /></div>}
          </div>
        )
      })}
    </div>
  )
}

function credentialsText(username: string, password: string) {
  return `SquidPanel login\nURL: ${location.origin}\nUsername: ${username}\nPassword: ${password}\n(Change your password after signing in: Account & security)`
}

export default function UsersPage() {
  const { user: me, meta } = useAuth()
  const { servers } = useServers()
  const { data, loading, reload } = useApi<{ users: User[] }>('/users')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all')
  const [create, setCreate] = useState<{ username: string; displayName: string; password: string; role: Role; grants: Grants } | null>(null)
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)
  const [accessFor, setAccessFor] = useState<{ user: User; grants: Grants } | null>(null)
  const [editFor, setEditFor] = useState<{ user: User; displayName: string; role: Role } | null>(null)
  const [resetFor, setResetFor] = useState<{ user: User; password: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()
  const isOwner = me!.role === 'owner'

  const users = useMemo(() => (data?.users || []).filter(u =>
    (roleFilter === 'all' || u.role === roleFilter) && (!search || `${u.username} ${u.displayName}`.toLowerCase().includes(search.toLowerCase()))
  ).sort((a, b) => ['owner', 'admin', 'member'].indexOf(a.role) - ['owner', 'admin', 'member'].indexOf(b.role) || a.username.localeCompare(b.username)), [data, search, roleFilter])
  const manageable = (u: User) => u.id !== me!.id && (isOwner || u.role === 'member')

  const submitCreate = async () => {
    if (!create) return
    setBusy(true)
    try {
      const grants = Object.fromEntries(Object.entries(create.grants).filter(([, g]) => g)) as Record<string, Grant>
      await api.post('/users', { username: create.username, displayName: create.displayName || create.username, password: create.password, role: create.role, grants: create.role === 'member' ? grants : {} })
      setCreated({ username: create.username, password: create.password })
      setCreate(null)
      reload(true)
    } catch (e) { errorToast(e) } finally { setBusy(false) }
  }

  const saveAccess = async () => {
    if (!accessFor) return
    setBusy(true)
    try {
      const before = accessFor.user.grants || {}
      for (const s of servers) {
        const g = accessFor.grants[s.id]
        const old = before[s.id]
        if (g && JSON.stringify(g) !== JSON.stringify(old)) await api.put(`/users/${accessFor.user.id}/grants/${s.id}`, g)
        else if (!g && old) await api.del(`/users/${accessFor.user.id}/grants/${s.id}`)
      }
      toast.success(`Access updated for ${accessFor.user.displayName}`)
      setAccessFor(null)
      reload(true)
    } catch (e) { errorToast(e) } finally { setBusy(false) }
  }

  const update = async (u: User, body: object, msg: string) => {
    try { await api.patch(`/users/${u.id}`, body); toast.success(msg); reload(true); return true } catch (e) { errorToast(e); return false }
  }
  const remove = async (u: User) => {
    if (!(await confirm({ title: `Delete ${u.displayName}'s account?`, body: 'They are signed out everywhere and lose all access. This cannot be undone.', confirmText: 'Delete account', tone: 'danger', typeToConfirm: u.username }))) return
    try { await api.del(`/users/${u.id}`); toast.success('Account deleted'); reload(true) } catch (e) { errorToast(e) }
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-7 lg:px-8">
      <PageHeader title="Users & access" description="Create accounts and decide exactly what each person can do on each server."
        actions={<Button variant="primary" icon={<UserPlus />} onClick={() => setCreate({ username: '', displayName: '', password: randomPassword(), role: 'member', grants: {} })}>New account</Button>} />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: <Crown />, title: 'Owner', text: 'Everything, including managing admins.' },
          { icon: <ShieldCheck />, title: 'Admin', text: 'Every server, can create and manage members.' },
          { icon: <KeyRound />, title: 'Member', text: 'Only what you grant, server by server.' },
        ].map(r => (
          <Card key={r.title} className="flex items-start gap-3 p-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-overlay text-muted [&_svg]:size-4">{r.icon}</div>
            <div><div className="text-[13px] font-semibold">{r.title}</div><div className="text-xs leading-relaxed text-muted">{r.text}</div></div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Input className="w-full sm:w-64" icon={<Search />} placeholder="Search accounts" value={search} onChange={e => setSearch(e.target.value)} />
          <Segmented size="sm" className="sm:ml-auto" value={roleFilter} onChange={setRoleFilter} options={[{ value: 'all', label: 'All' }, { value: 'owner', label: 'Owner' }, { value: 'admin', label: 'Admins' }, { value: 'member', label: 'Members' }]} />
        </div>
        {loading && !data ? <div className="space-y-2 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14" />)}</div> : users.length ? (
          <div className="divide-y divide-line">
            {users.map(u => {
              const grantIds = Object.keys(u.grants || {}).filter(id => servers.some(s => s.id === id))
              return (
                <div key={u.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5', u.disabled && 'opacity-60')}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <UserAvatar name={u.displayName} size={36} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">{u.displayName}{u.id === me!.id && <Badge>you</Badge>}{u.disabled && <Badge tone="bad">suspended</Badge>}</div>
                      <div className="text-xs text-faint">@{u.username} · {u.lastLoginAt ? `active ${ago(u.lastLoginAt)}` : 'never signed in'}{u.createdBy ? ` · added by ${u.createdBy}` : ''}</div>
                    </div>
                  </div>
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    {u.role === 'member' ? (
                      <div className="flex items-center gap-1.5">
                        {grantIds.length ? grantIds.slice(0, 4).map(id => {
                          const s = servers.find(x => x.id === id)!
                          return <span key={id} title={`${s.name}: ${grantSummary(u.grants[id], meta)}`}><ServerIcon server={s} size={22} /></span>
                        }) : <span className="text-xs text-faint">no servers</span>}
                        {grantIds.length > 4 && <span className="text-xs text-faint">+{grantIds.length - 4}</span>}
                      </div>
                    ) : <span className="text-xs text-faint">all servers</span>}
                    <div className="w-20 text-right"><RoleBadge role={u.role} /></div>
                    {manageable(u) ? (
                      <Menu>
                        <MenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Account actions"><MoreHorizontal /></Button></MenuTrigger>
                        <MenuContent>
                          {u.role === 'member' && <MenuItem icon={<KeyRound />} onSelect={() => setAccessFor({ user: u, grants: { ...u.grants } })}>Server access…</MenuItem>}
                          <MenuItem icon={<Pencil />} onSelect={() => setEditFor({ user: u, displayName: u.displayName, role: u.role })}>Edit profile & role…</MenuItem>
                          <MenuItem icon={<RefreshCw />} onSelect={() => setResetFor({ user: u, password: randomPassword() })}>Reset password…</MenuItem>
                          <MenuItem icon={u.disabled ? <UserCheck /> : <UserX />} onSelect={() => update(u, { disabled: !u.disabled }, u.disabled ? 'Account reactivated' : 'Account suspended')}>{u.disabled ? 'Reactivate' : 'Suspend'}</MenuItem>
                          <MenuSeparator />
                          <MenuItem icon={<Trash2 />} danger onSelect={() => remove(u)}>Delete account</MenuItem>
                        </MenuContent>
                      </Menu>
                    ) : <span className="w-7" />}
                  </div>
                </div>
              )
            })}
          </div>
        ) : <Empty icon={<UsersIcon />} title="No accounts match" />}
      </Card>

      {/* Create */}
      <Dialog open={!!create} onOpenChange={v => !v && setCreate(null)} size="lg" icon={<UserPlus />} title="New account" description="They sign in with this username and password at this panel's address."
        footer={<><Button variant="ghost" onClick={() => setCreate(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!create?.username || (create?.password.length || 0) < 8} onClick={submitCreate}>Create account</Button></>}>
        {create && meta && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username" help="3–24 letters, numbers, . _ -"><Input data-autofocus value={create.username} onChange={e => setCreate({ ...create, username: e.target.value.trim() })} placeholder="alex" /></Field>
              <Field label="Display name" hint="optional"><Input value={create.displayName} onChange={e => setCreate({ ...create, displayName: e.target.value })} placeholder="Alex" /></Field>
            </div>
            <Field label="Password" help="A random password is filled in — copy it and send it to them.">
              <Input value={create.password} onChange={e => setCreate({ ...create, password: e.target.value })} className="font-mono"
                right={<Button size="icon-sm" variant="ghost" type="button" onClick={() => setCreate({ ...create, password: randomPassword() })} aria-label="Generate"><RefreshCw /></Button>} />
            </Field>
            {isOwner && (
              <Field label="Role">
                <Segmented className="flex" value={create.role} onChange={v => setCreate({ ...create, role: v })} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} />
              </Field>
            )}
            {create.role === 'member' ? (
              <div>
                <div className="mb-2 text-[13px] font-medium">Server access</div>
                <GrantMatrix servers={servers} meta={meta} value={create.grants} onChange={g => setCreate({ ...create, grants: g })} />
              </div>
            ) : <Callout tone="brand" icon={<ShieldCheck />}>Admins get full control of every server and can manage member accounts.</Callout>}
          </div>
        )}
      </Dialog>

      {/* Credentials after create / reset */}
      <Dialog open={!!created} onOpenChange={v => !v && setCreated(null)} size="sm" icon={<UserCheck />} title="Account ready" description="Send these details to them. The password is not shown again."
        footer={<><Button variant="ghost" onClick={() => setCreated(null)}>Done</Button><Button variant="primary" icon={<Copy />} onClick={async () => { if (created && await copy(credentialsText(created.username, created.password))) toast.success('Copied to clipboard') }}>Copy login details</Button></>}>
        {created && <pre className="whitespace-pre-wrap rounded-xl border border-line bg-bg/60 p-4 font-mono text-xs leading-relaxed text-fg/90">{credentialsText(created.username, created.password)}</pre>}
      </Dialog>

      {/* Access matrix */}
      <Dialog open={!!accessFor} onOpenChange={v => !v && setAccessFor(null)} size="lg" icon={<KeyRound />} title={`Server access · ${accessFor?.user.displayName}`}
        description="Choose a preset per server, or customise the exact permissions."
        footer={<><Button variant="ghost" onClick={() => setAccessFor(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={saveAccess}>Save access</Button></>}>
        {accessFor && meta && <GrantMatrix servers={servers} meta={meta} value={accessFor.grants} onChange={g => setAccessFor({ ...accessFor, grants: g })} />}
      </Dialog>

      {/* Edit profile */}
      <Dialog open={!!editFor} onOpenChange={v => !v && setEditFor(null)} size="sm" icon={<Pencil />} title={`Edit ${editFor?.user.username}`}
        footer={<><Button variant="ghost" onClick={() => setEditFor(null)}>Cancel</Button><Button variant="primary" onClick={async () => { if (editFor && await update(editFor.user, { displayName: editFor.displayName, ...(isOwner ? { role: editFor.role } : {}) }, 'Account updated')) setEditFor(null) }}>Save</Button></>}>
        {editFor && (
          <div className="space-y-4">
            <Field label="Display name"><Input data-autofocus value={editFor.displayName} onChange={e => setEditFor({ ...editFor, displayName: e.target.value })} /></Field>
            {isOwner && <Field label="Role" help="Admins can see and control every server."><Segmented className="flex" value={editFor.role} onChange={v => setEditFor({ ...editFor, role: v })} options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]} /></Field>}
            {editFor.user.role === 'member' && Object.keys(editFor.user.grants || {}).length > 0 && <div className="flex flex-wrap gap-1.5">{Object.entries(editFor.user.grants).map(([sid, g]) => <span key={sid} className="flex items-center gap-1.5 text-xs text-muted">{servers.find(s => s.id === sid)?.name || sid}<ConsoleBadge level={g.console} /></span>)}</div>}
          </div>
        )}
      </Dialog>

      {/* Reset password */}
      <Dialog open={!!resetFor} onOpenChange={v => !v && setResetFor(null)} size="sm" icon={<RefreshCw />} title={`Reset password for ${resetFor?.user.username}`} description="They will be signed out of every device."
        footer={<><Button variant="ghost" onClick={() => setResetFor(null)}>Cancel</Button><Button variant="primary" disabled={(resetFor?.password.length || 0) < 8} onClick={async () => { if (resetFor && await update(resetFor.user, { password: resetFor.password }, 'Password reset')) { setCreated({ username: resetFor.user.username, password: resetFor.password }); setResetFor(null) } }}>Reset password</Button></>}>
        {resetFor && <Field label="New password"><Input className="font-mono" value={resetFor.password} onChange={e => setResetFor({ ...resetFor, password: e.target.value })} right={<Button size="icon-sm" variant="ghost" type="button" onClick={() => setResetFor({ ...resetFor, password: randomPassword() })}><RefreshCw /></Button>} /></Field>}
      </Dialog>
    </div>
  )
}
