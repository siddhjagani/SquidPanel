import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { AlertTriangle, Cpu, Gamepad2, Info, Moon, Rocket, Save, Search, Settings2, ShieldBan, Terminal, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, type LaunchSettings, type ServerSettings } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useApi } from '@/lib/hooks'
import { useServers } from '@/lib/servers'
import { cn } from '@/lib/format'
import { Badge, Button, Callout, Card, CardHeader, Field, Input, Select, Switch, ToggleRow, errorToast, useConfirm } from '@/components/ui'
import { SERVER_COLOR_KEYS, ServerIcon } from '@/components/domain'
import { useServer } from './Layout'

interface Runtime { path: string; version: string; major: number; vendor: string; bundled: boolean }

function Section({ id, title, description, icon, children, footer }: { id: string; title: string; description?: string; icon: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeader title={title} description={description} icon={icon} />
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line bg-raised/30 px-5 py-3">{footer}</div>}
    </Card>
  )
}

// Common server.properties keys with typed editors.
const GAME_FIELDS: { key: string; label: string; type: 'text' | 'number' | 'bool' | 'select'; options?: string[]; help?: string }[] = [
  { key: 'motd', label: 'Message of the day', type: 'text', help: 'Shown in the multiplayer server list. Supports § colour codes.' },
  { key: 'max-players', label: 'Max players', type: 'number' },
  { key: 'gamemode', label: 'Default game mode', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'] },
  { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'] },
  { key: 'view-distance', label: 'View distance', type: 'number', help: 'Chunks. Lower = less CPU/RAM.' },
  { key: 'simulation-distance', label: 'Simulation distance', type: 'number' },
  { key: 'spawn-protection', label: 'Spawn protection radius', type: 'number' },
  { key: 'server-port', label: 'Server port', type: 'number', help: 'Your tunnel (e.g. playit) must point at this port.' },
  { key: 'pvp', label: 'PvP', type: 'bool' },
  { key: 'online-mode', label: 'Online mode', type: 'bool', help: 'Verify accounts with Mojang. Off allows cracked/offline players.' },
  { key: 'white-list', label: 'Whitelist', type: 'bool' },
  { key: 'allow-flight', label: 'Allow flight', type: 'bool', help: 'Recommended on for modpacks with jetpacks/flying items.' },
  { key: 'hardcore', label: 'Hardcore', type: 'bool' },
  { key: 'enable-command-block', label: 'Command blocks', type: 'bool' },
  { key: 'spawn-monsters', label: 'Spawn monsters', type: 'bool' },
  { key: 'allow-nether', label: 'Allow Nether', type: 'bool' },
]

export default function ServerSettingsPage() {
  const { server, reload } = useServer()
  const { reload: reloadAll } = useServers()
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const confirm = useConfirm()

  const [general, setGeneral] = useState({ name: server.name, address: server.address, color: server.color })
  const [auto, setAuto] = useState<ServerSettings>(server.settings)
  const [launch, setLaunch] = useState<LaunchSettings | undefined>(server.launch)
  const [restricted, setRestricted] = useState<string[]>(server.settings.restrictedCommands || [])
  const [newCmd, setNewCmd] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const props = useApi<{ properties: Record<string, string>; running: boolean }>(`/servers/${server.id}/properties`)
  const [propEdits, setPropEdits] = useState<Record<string, string>>({})
  const [propFilter, setPropFilter] = useState('')
  const [showAll, setShowAll] = useState(false)
  const java = useApi<{ runtimes: Runtime[] }>(isAdmin ? '/system/java' : null)

  useEffect(() => { setPropEdits({}) }, [props.data])
  const propVal = (k: string) => propEdits[k] ?? props.data?.properties[k] ?? ''
  const setProp = (k: string, v: string) => setPropEdits(p => ({ ...p, [k]: v }))
  const propsDirty = Object.keys(propEdits).some(k => propEdits[k] !== (props.data?.properties[k] ?? ''))
  const rconOn = String(props.data?.properties['enable-rcon']).toLowerCase() === 'true'

  const patch = async (key: string, body: object, msg = 'Settings saved') => {
    setSaving(key)
    try { await api.patch(`/servers/${server.id}`, body); toast.success(msg); await reload() } catch (e) { errorToast(e) } finally { setSaving(null) }
  }
  const saveProps = async () => {
    setSaving('props')
    try {
      const r = await api.put<{ restartRequired: boolean }>(`/servers/${server.id}/properties`, { properties: propEdits })
      toast.success('server.properties saved', { description: r.restartRequired ? 'Restart the server to apply the changes.' : undefined })
      props.reload(true)
    } catch (e) { errorToast(e) } finally { setSaving(null) }
  }
  const toggleRcon = async (enable: boolean) => {
    try { const r = await api.post<{ restartRequired: boolean }>(`/servers/${server.id}/rcon`, { enable }); toast.success(enable ? 'RCON enabled' : 'RCON disabled', { description: r.restartRequired ? 'Takes effect after a restart.' : undefined }); props.reload(true) } catch (e) { errorToast(e) }
  }
  const removeServer = async () => {
    if (!(await confirm({ title: `Remove ${server.name} from SquidPanel?`, body: 'The server folder and its worlds stay on disk — it just disappears from the panel. Everyone loses access.', confirmText: 'Remove server', tone: 'danger', typeToConfirm: server.name }))) return
    try { await api.del(`/servers/${server.id}`); toast.success('Server removed'); await reloadAll(); navigate('/') } catch (e) { errorToast(e) }
  }

  const allProps = useMemo(() => Object.keys({ ...(props.data?.properties || {}), ...propEdits }).sort().filter(k => !propFilter || k.includes(propFilter.toLowerCase())), [props.data, propEdits, propFilter])
  const javaOptions = [{ value: 'auto', label: 'Automatic (best match for this version)' }, ...(java.data?.runtimes || []).map(r => ({ value: r.path, label: `Java ${r.version}${r.bundled ? ' · SquidServers bundled' : ''}` }))]
  const isScript = server.launchType === 'script'

  const nav = [
    ['general', 'General'], ['automation', 'Automation'], ['game', 'Game rules'], ...(isAdmin ? [['launch', 'Launch & memory'], ['console', 'Console safety'], ['danger', 'Danger zone']] : []),
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
      <nav className="hidden lg:block">
        <div className="sticky top-6 space-y-0.5">
          {nav.map(([id, label]) => <a key={id} href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-[13px] text-muted hover:bg-overlay hover:text-fg">{label}</a>)}
        </div>
      </nav>
      <div className="min-w-0 space-y-6">
        <Section id="general" title="General" icon={<Settings2 />}
          footer={<Button variant="primary" icon={<Save />} loading={saving === 'general'} onClick={() => patch('general', general)}>Save</Button>}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Display name"><Input value={general.name} onChange={e => setGeneral({ ...general, name: e.target.value })} /></Field>
            <Field label="Public address" help="What players type to join — e.g. your playit.gg tunnel address."><Input value={general.address} placeholder="example.joinmc.link" onChange={e => setGeneral({ ...general, address: e.target.value })} /></Field>
          </div>
          <div className="mt-4">
            <div className="mb-2 text-[13px] font-medium">Icon colour <span className="font-normal text-faint">(used when the server has no server-icon.png)</span></div>
            <div className="flex flex-wrap items-center gap-2">
              {SERVER_COLOR_KEYS.map(c => (
                <button key={c} onClick={() => setGeneral({ ...general, color: c })} className={cn('rounded-xl p-0.5 ring-2 transition', general.color === c ? 'ring-brand' : 'ring-transparent hover:ring-line-strong')}>
                  <ServerIcon server={{ ...server, color: c, hasIcon: false, name: general.name || server.name }} size={34} />
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section id="automation" title="Automation" description="Run only when people are playing." icon={<Moon />}
          footer={<Button variant="primary" icon={<Save />} loading={saving === 'auto'} onClick={() => patch('auto', { settings: { autoStop: auto.autoStop, idleMinutes: auto.idleMinutes, autoStart: auto.autoStart, restartOnCrash: auto.restartOnCrash, stopTimeout: auto.stopTimeout } })}>Save</Button>}>
          <div className="divide-y divide-line">
            <ToggleRow title="Sleep when empty" description="Stop the server automatically after nobody has been online for a while — saves RAM, CPU and battery." checked={auto.autoStop} onChange={v => setAuto({ ...auto, autoStop: v })}>
              {auto.autoStop && (
                <div className="mt-3 flex items-center gap-2 text-[13px]">
                  after <Input type="number" min={1} max={1440} className="w-20" value={auto.idleMinutes} onChange={e => setAuto({ ...auto, idleMinutes: Number(e.target.value) })} /> minutes with 0 players
                </div>
              )}
            </ToggleRow>
            <ToggleRow title="Start with the Mac" description="Start this server whenever SquidPanel starts (e.g. after a reboot)." checked={auto.autoStart} onChange={v => setAuto({ ...auto, autoStart: v })} />
            <ToggleRow title="Restart after a crash" description="If the server dies unexpectedly, start it again (up to 3 times in 10 minutes)." checked={auto.restartOnCrash} onChange={v => setAuto({ ...auto, restartOnCrash: v })} />
            <div className="flex items-center justify-between gap-6 py-3.5">
              <div><div className="text-sm font-medium">Graceful stop timeout</div><div className="text-[13px] text-muted">How long to wait for a clean shutdown before forcing it.</div></div>
              <div className="flex items-center gap-2 text-[13px] text-muted"><Input type="number" min={15} max={600} className="w-20" value={auto.stopTimeout} onChange={e => setAuto({ ...auto, stopTimeout: Number(e.target.value) })} />sec</div>
            </div>
          </div>
        </Section>

        <Section id="game" title="Game rules" description="Edits server.properties — comments and unknown keys are preserved." icon={<Gamepad2 />}
          footer={<>{propsDirty && <Button variant="ghost" onClick={() => setPropEdits({})}>Discard</Button>}<Button variant="primary" icon={<Save />} disabled={!propsDirty} loading={saving === 'props'} onClick={saveProps}>Save properties</Button></>}>
          {props.data?.running && <Callout tone="info" icon={<Info />} className="mb-4">The server is running — most changes apply after a restart.</Callout>}
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
            {GAME_FIELDS.filter(f => f.type !== 'bool').map(f => (
              <Field key={f.key} label={f.label} hint={<span className="font-mono">{f.key}</span>} help={f.help} className={f.key === 'motd' ? 'md:col-span-2' : ''}>
                {f.type === 'select'
                  ? <Select value={propVal(f.key)} onChange={v => setProp(f.key, v)} options={[...new Set([propVal(f.key), ...f.options!])].filter(Boolean).map(o => ({ value: o, label: o }))} />
                  : <Input type={f.type} value={propVal(f.key)} onChange={e => setProp(f.key, e.target.value)} />}
              </Field>
            ))}
          </div>
          <div className="mt-5 grid gap-x-6 sm:grid-cols-2">
            {GAME_FIELDS.filter(f => f.type === 'bool').map(f => (
              <div key={f.key} className="flex items-center justify-between gap-4 border-t border-line py-3">
                <div><div className="text-[13px] font-medium">{f.label}</div>{f.help && <div className="text-xs text-faint">{f.help}</div>}</div>
                <Switch checked={propVal(f.key) === 'true'} onChange={v => setProp(f.key, String(v))} />
              </div>
            ))}
          </div>
          <button onClick={() => setShowAll(v => !v)} className="mt-4 text-[13px] text-brand hover:underline">{showAll ? 'Hide' : 'Show'} all {Object.keys(props.data?.properties || {}).length} properties</button>
          {showAll && (
            <div className="mt-3 rounded-xl border border-line">
              <div className="border-b border-line p-2"><Input icon={<Search />} placeholder="Filter keys" value={propFilter} onChange={e => setPropFilter(e.target.value)} /></div>
              <div className="scrollbar-thin max-h-[420px] divide-y divide-line overflow-y-auto">
                {allProps.map(k => (
                  <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3 px-3 py-1.5">
                    <span className="truncate font-mono text-xs text-muted">{k}</span>
                    <input value={propVal(k)} onChange={e => setProp(k, e.target.value)} disabled={!isAdmin && /rcon|management|query/.test(k)}
                      className={cn('h-8 rounded-md border border-transparent bg-transparent px-2 font-mono text-xs hover:border-line-strong focus:border-brand/60 focus:bg-bg focus:outline-none disabled:opacity-40', propEdits[k] !== undefined && propEdits[k] !== props.data?.properties[k] && 'border-brand/40 bg-brand/5')}
                      type={/password|secret/.test(k) ? 'password' : 'text'} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {isAdmin && launch && (
          <Section id="launch" title="Launch & memory" description="How SquidPanel starts this server. Applies on the next start." icon={<Rocket />}
            footer={<Button variant="primary" icon={<Save />} loading={saving === 'launch'} onClick={() => patch('launch', { launch })}>Save</Button>}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Start method">
                <Select value={launch.type} onChange={v => setLaunch({ ...launch, type: v as LaunchSettings['type'] })} options={[
                  { value: 'auto', label: `Automatic (${isScript ? 'run script' : 'server jar'})` },
                  { value: 'jar', label: 'Run the server jar with Java' },
                  { value: 'script', label: 'Run the start script (run.sh)' },
                  { value: 'custom', label: 'Custom command' },
                ]} />
              </Field>
              <Field label="Java runtime" help={isScript && launch.type !== 'jar' ? 'Script servers use the Java set inside run.sh.' : 'Paper 26.x needs Java 25; 1.20.5–1.21 needs Java 21.'}>
                <Select value={launch.java || 'auto'} onChange={v => setLaunch({ ...launch, java: v })} options={javaOptions} />
              </Field>
              <Field label="Minimum memory" hint="-Xms"><Input value={launch.minRam} placeholder="1G" onChange={e => setLaunch({ ...launch, minRam: e.target.value.toUpperCase() })} /></Field>
              <Field label="Maximum memory" hint="-Xmx" help={isScript ? 'Written to user_jvm_args.txt for this script-based server.' : undefined}><Input value={launch.maxRam} placeholder="4G" onChange={e => setLaunch({ ...launch, maxRam: e.target.value.toUpperCase() })} /></Field>
              {(launch.type === 'jar' || (launch.type === 'auto' && !isScript)) && <>
                <Field label="Server jar" hint="blank = auto"><Input value={launch.jar} placeholder="server.jar" onChange={e => setLaunch({ ...launch, jar: e.target.value })} /></Field>
                <Field label="Extra JVM flags"><Input value={launch.jvmArgs} placeholder="-XX:+UseG1GC" onChange={e => setLaunch({ ...launch, jvmArgs: e.target.value })} /></Field>
              </>}
              {launch.type === 'custom' && (
                <Field label="Custom command" className="md:col-span-2" help="Runs with /bin/sh in the server folder. Must keep the server in the foreground.">
                  <Input value={launch.custom} className="font-mono" placeholder="java -Xmx6G -jar server.jar nogui" onChange={e => setLaunch({ ...launch, custom: e.target.value })} />
                </Field>
              )}
            </div>
            {server.dir && <div className="mt-4 flex items-center gap-2 text-xs text-faint"><Cpu className="size-3.5" />Folder: <span className="font-mono text-muted">{server.dir}</span></div>}
          </Section>
        )}

        {isAdmin && (
          <Section id="console" title="Console safety" description='Commands blocked for people with “Commands” console access. Operators can run anything.' icon={<ShieldBan />}
            footer={<Button variant="primary" icon={<Save />} loading={saving === 'console'} onClick={() => patch('console', { settings: { restrictedCommands: restricted } })}>Save</Button>}>
            <div className="flex flex-wrap gap-1.5">
              {restricted.map(c => (
                <span key={c} className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-overlay py-0.5 pl-2 pr-1 font-mono text-xs">
                  {c}<button onClick={() => setRestricted(restricted.filter(x => x !== c))} className="rounded p-0.5 text-faint hover:text-bad"><X className="size-3" /></button>
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Input className="max-w-xs" placeholder="Add a command, e.g. gamemode" value={newCmd} onChange={e => setNewCmd(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newCmd.trim()) { setRestricted([...new Set([...restricted, newCmd.trim().replace(/^\//, '').toLowerCase()])]); setNewCmd('') } }} />
              <Button onClick={() => { if (newCmd.trim()) { setRestricted([...new Set([...restricted, newCmd.trim().replace(/^\//, '').toLowerCase()])]); setNewCmd('') } }}>Add</Button>
            </div>
            <div className="mt-5 flex items-start justify-between gap-6 border-t border-line pt-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium"><Terminal className="size-4 text-muted" />RCON {rconOn ? <Badge tone="ok">on</Badge> : <Badge>off</Badge>}</div>
                <p className="mt-1 max-w-lg text-[13px] text-muted">Only needed if you sometimes start this server from another app (like SquidServers) and still want to send commands from here. A random password is generated for you.</p>
              </div>
              <Switch checked={rconOn} onChange={toggleRcon} />
            </div>
          </Section>
        )}

        {isAdmin && (
          <Section id="danger" title="Danger zone" icon={<AlertTriangle />}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><div className="text-sm font-medium">Remove from SquidPanel</div><div className="text-[13px] text-muted">Files on disk are not deleted.</div></div>
              <Button variant="danger" icon={<Trash2 />} disabled={!!server.runtime.pid} onClick={removeServer}>{server.runtime.pid ? 'Stop the server first' : 'Remove server'}</Button>
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
