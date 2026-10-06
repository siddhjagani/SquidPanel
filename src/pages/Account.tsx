import { useState } from 'react'
import { KeyRound, Laptop, LogOut, Smartphone, User as UserIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApi } from '@/lib/hooks'
import { useServers } from '@/lib/servers'
import { ago } from '@/lib/format'
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, errorToast } from '@/components/ui'
import { ConsoleBadge, RoleBadge, ServerIcon, UserAvatar, grantSummary } from '@/components/domain'

interface Session { id: string; createdAt: number; lastSeenAt: number; ip: string; agent: string; current: boolean }

function device(agent: string) {
  const mobile = /iPhone|Android|iPad|Mobile/i.test(agent)
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(agent) ? 'iOS' : /Android/.test(agent) ? 'Android' : /Mac OS X/.test(agent) ? 'macOS' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : ''
  return { mobile, label: `${browser}${os ? ` on ${os}` : ''}` }
}

export default function Account() {
  const { user, meta, refresh } = useAuth()
  const { servers } = useServers()
  const sessions = useApi<{ sessions: Session[] }>('/auth/sessions')
  const [name, setName] = useState(user!.displayName)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState<string | null>(null)

  const saveName = async () => {
    setBusy('name')
    try { await api.patch('/auth/me', { displayName: name }); await refresh(); toast.success('Profile updated') } catch (e) { errorToast(e) } finally { setBusy(null) }
  }
  const changePw = async () => {
    if (pw.next !== pw.confirm) return toast.error('New passwords do not match')
    setBusy('pw')
    try { await api.patch('/auth/me', { currentPassword: pw.current, newPassword: pw.next }); setPw({ current: '', next: '', confirm: '' }); toast.success('Password changed — other devices were signed out'); sessions.reload(true) } catch (e) { errorToast(e) } finally { setBusy(null) }
  }
  const revoke = async (id: string) => {
    try { await api.del(`/auth/sessions/${id}`); sessions.reload(true) } catch (e) { errorToast(e) }
  }

  return (
    <div className="mx-auto max-w-[860px] px-5 py-7 lg:px-8">
      <PageHeader title="Account & security" />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" icon={<UserIcon />} />
          <div className="flex flex-wrap items-end gap-4 p-5">
            <UserAvatar name={name || user!.username} size={52} />
            <Field label="Display name" className="min-w-[220px] flex-1"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
            <Button loading={busy === 'name'} disabled={name === user!.displayName} onClick={saveName}>Save</Button>
          </div>
          <div className="flex items-center gap-3 border-t border-line px-5 py-3 text-[13px] text-muted">@{user!.username}<RoleBadge role={user!.role} /></div>
        </Card>

        {user!.role === 'member' && (
          <Card>
            <CardHeader title="Your access" description="Granted by the owner or an admin." icon={<KeyRound />} />
            <div className="divide-y divide-line">
              {servers.map(s => (
                <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <ServerIcon server={s} size={28} />
                  <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{s.name}</div><div className="truncate text-xs text-faint">{grantSummary(user!.grants[s.id], meta)}</div></div>
                  <ConsoleBadge level={s.access.console} />
                </div>
              ))}
              {!servers.length && <div className="px-5 py-6 text-center text-[13px] text-faint">No servers shared with you yet.</div>}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Change password" icon={<KeyRound />} />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Current"><Input type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New" hint="8+ chars"><Input type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Confirm"><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end border-t border-line bg-raised/30 px-5 py-3"><Button variant="primary" loading={busy === 'pw'} disabled={!pw.current || pw.next.length < 8} onClick={changePw}>Update password</Button></div>
        </Card>

        <Card>
          <CardHeader title="Signed-in devices" description="Sign out anything you don't recognise." icon={<Laptop />} />
          <div className="divide-y divide-line">
            {(sessions.data?.sessions || []).map(s => {
              const d = device(s.agent)
              return (
                <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-overlay text-muted">{d.mobile ? <Smartphone className="size-4" /> : <Laptop className="size-4" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px] font-medium">{d.label}{s.current && <Badge tone="ok">this device</Badge>}</div>
                    <div className="text-xs text-faint">{s.ip || 'unknown IP'} · active {ago(s.lastSeenAt)} · signed in {ago(s.createdAt)}</div>
                  </div>
                  {!s.current && <Button size="sm" variant="ghost" icon={<LogOut />} onClick={() => revoke(s.id)}>Sign out</Button>}
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
