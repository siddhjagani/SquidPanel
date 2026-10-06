import { useState } from 'react'
import { KeyRound, Pencil, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Access as AccessT, type Grant, type Role } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApi } from '@/lib/hooks'
import { Button, Callout, Card, CardHeader, Dialog, Empty, Field, Select, Skeleton, errorToast, useConfirm } from '@/components/ui'
import { ConsoleBadge, GrantEditor, RoleBadge, UserAvatar, grantSummary } from '@/components/domain'
import { useServer } from './Layout'

interface Row { id: string; username: string; displayName: string; role: Role; disabled: boolean; access: AccessT; grant: Grant | null; editable: boolean }

export default function Access() {
  const { server } = useServer()
  const { meta, user, isAdmin } = useAuth()
  const { data, loading, reload } = useApi<{ users: Row[]; mine: AccessT }>(`/servers/${server.id}/access`)
  const [edit, setEdit] = useState<{ user: Row | null; grant: Grant; pick?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()

  const admins = (data?.users || []).filter(u => u.role !== 'member')
  const members = (data?.users || []).filter(u => u.role === 'member' && u.grant)
  const candidates = (data?.users || []).filter(u => u.role === 'member' && !u.grant && u.editable && u.id !== user!.id)
  // Members can only share up to what they have themselves.
  const ceiling: Grant | null = isAdmin || !data ? null : { console: data.mine.console, perms: data.mine.perms }

  const save = async () => {
    if (!edit) return
    const uid = edit.user?.id || edit.pick
    if (!uid) return toast.error('Choose an account')
    setSaving(true)
    try { await api.put(`/users/${uid}/grants/${server.id}`, edit.grant); toast.success('Access saved'); setEdit(null); reload(true) } catch (e) { errorToast(e) } finally { setSaving(false) }
  }
  const revoke = async (u: Row) => {
    if (!(await confirm({ title: `Remove ${u.displayName}'s access?`, body: `They will no longer see ${server.name}.`, confirmText: 'Remove access', tone: 'danger' }))) return
    try { await api.del(`/users/${u.id}/grants/${server.id}`); reload(true) } catch (e) { errorToast(e) }
  }

  return (
    <div className="space-y-6">
      {!isAdmin && <Callout tone="brand" icon={<KeyRound />} title="Sharing access">You can share this server with other members, up to the permissions you have yourself.</Callout>}
      <Card>
        <CardHeader title="People with access" description={`Who can see and control ${server.name}`} icon={<KeyRound />}
          actions={<Button variant="primary" icon={<UserPlus />} disabled={!candidates.length} onClick={() => setEdit({ user: null, grant: { console: 1, perms: ['players.view'] }, pick: candidates[0]?.id })}>Give access</Button>} />
        {loading && !data ? <div className="space-y-2 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}</div> : (
          <div className="divide-y divide-line">
            {admins.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3">
                <UserAvatar name={u.displayName} size={32} />
                <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{u.displayName} <span className="font-normal text-faint">@{u.username}</span></div><div className="text-xs text-faint">Full access to every server</div></div>
                <RoleBadge role={u.role} />
              </div>
            ))}
            {members.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3">
                <UserAvatar name={u.displayName} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium">{u.displayName} <span className="font-normal text-faint">@{u.username}</span>{u.disabled && <span className="ml-2 text-xs text-bad">suspended</span>}</div>
                  <div className="truncate text-xs text-faint">{grantSummary(u.grant, meta)}</div>
                </div>
                <ConsoleBadge level={u.grant!.console} />
                {u.editable && <>
                  <Button size="icon-sm" variant="ghost" aria-label="Edit access" onClick={() => setEdit({ user: u, grant: { console: u.grant!.console, perms: [...u.grant!.perms] } })}><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Remove access" onClick={() => revoke(u)}><Trash2 /></Button>
                </>}
              </div>
            ))}
            {!members.length && <Empty icon={<ShieldCheck />} title="Only admins so far">Give friends access to start, watch the console or manage players — without handing over everything.</Empty>}
          </div>
        )}
      </Card>

      <Dialog open={!!edit} onOpenChange={v => !v && setEdit(null)} size="lg" icon={<KeyRound />}
        title={edit?.user ? `Access for ${edit.user.displayName}` : 'Give someone access'}
        description={`What they can do on ${server.name}`}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={saving} onClick={save}>Save access</Button></>}>
        {edit && meta && (
          <div className="space-y-5">
            {!edit.user && (
              <Field label="Account" help={isAdmin ? 'Need a new account? Create it on the Users page.' : undefined}>
                <Select value={edit.pick || ''} onChange={v => setEdit({ ...edit, pick: v })} options={candidates.map(c => ({ value: c.id, label: `${c.displayName} (@${c.username})` }))} />
              </Field>
            )}
            <GrantEditor meta={meta} value={edit.grant} onChange={g => setEdit({ ...edit, grant: g })} ceiling={ceiling} />
          </div>
        )}
      </Dialog>
    </div>
  )
}
