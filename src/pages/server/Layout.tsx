import { NavLink, Outlet, useOutletContext, useParams } from 'react-router'
import { AlertTriangle, Archive, Box, FolderOpen, Gauge, Globe2, KeyRound, Loader2, Plug, ServerCrash, Settings, Terminal, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useServers } from '@/lib/servers'
import { useNow } from '@/lib/hooks'
import { bytes, cn } from '@/lib/format'
import { joinAddress, type Server } from '@/lib/api'
import { Badge, Callout, CopyButton, Empty, Spinner } from '@/components/ui'
import { PowerControls, ServerIcon, StatusPill } from '@/components/domain'

export interface ServerCtx { server: Server; reload: () => Promise<void> }
// eslint-disable-next-line react-refresh/only-export-components
export const useServer = () => useOutletContext<ServerCtx>()

function Tab({ to, icon, children, end }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn('relative flex shrink-0 items-center gap-2 px-1 pb-3 pt-1 text-[13px] font-medium transition-colors [&_svg]:size-4',
        isActive ? 'text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand' : 'text-muted hover:text-fg')}
    >
      {icon}{children}
    </NavLink>
  )
}

export default function ServerLayout() {
  const { id } = useParams()
  const { servers, loading, reload } = useServers()
  const now = useNow(15000)
  const server = servers.find(s => s.id === id)
  if (!server) {
    return loading ? <div className="flex h-64 items-center justify-center"><Spinner /></div>
      : <Empty className="mt-20" icon={<ServerCrash />} title="Server not found">It may have been removed, or your access was revoked.</Empty>
  }
  const rt = server.runtime
  const a = server.access
  const can = (p: string) => a.perms.includes(p)
  const base = `/servers/${server.id}`
  const recentCrash = rt.status === 'offline' && rt.lastCrash && now - rt.lastCrash < 30 * 60000

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line bg-surface/40">
        <div className="mx-auto max-w-[1280px] px-5 pt-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-4">
            <ServerIcon server={server} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="truncate text-[22px] font-semibold tracking-tight">{server.name}</h1>
                <StatusPill status={rt.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                <span className="flex items-center gap-1.5"><Badge>{server.software}</Badge>{server.mcVersion && <Badge>{server.mcVersion}</Badge>}</span>
                {joinAddress(server) ? (
                  <span className="flex items-center gap-0.5 font-mono text-xs">{joinAddress(server)}<CopyButton value={joinAddress(server)!} /></span>
                ) : <span className="font-mono text-xs text-faint">localhost:{rt.port}</span>}
              </div>
            </div>
            <PowerControls server={server} runtime={rt} onChange={reload} />
          </div>
          <nav className="scrollbar-thin -mb-px mt-6 flex gap-5 overflow-x-auto">
            <Tab to={base} end icon={<Gauge />}>Overview</Tab>
            {a.console > 0 && <Tab to={`${base}/console`} icon={<Terminal />}>Console</Tab>}
            {can('players.view') && <Tab to={`${base}/players`} icon={<Users />}>Players</Tab>}
            {can('addons.manage') && <Tab to={`${base}/addons`} icon={server.addonsDir === 'plugins' ? <Plug /> : <Box />}>{server.addonsDir === 'plugins' ? 'Plugins' : 'Mods'}</Tab>}
            {can('worlds.manage') && <Tab to={`${base}/worlds`} icon={<Globe2 />}>Worlds</Tab>}
            {can('backups.manage') && <Tab to={`${base}/backups`} icon={<Archive />}>Backups</Tab>}
            {can('files.manage') && <Tab to={`${base}/files`} icon={<FolderOpen />}>Files</Tab>}
            {can('access.manage') && <Tab to={`${base}/access`} icon={<KeyRound />}>Access</Tab>}
            {can('settings.edit') && <Tab to={`${base}/settings`} icon={<Settings />}>Settings</Tab>}
          </nav>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1280px] flex-1 px-5 py-6 lg:px-8">
        <div className="space-y-3 empty:hidden [&:not(:empty)]:mb-6">
          {server.missing && <Callout tone="bad" icon={<AlertTriangle />} title="Server folder not found">The folder <span className="font-mono">{server.dir || 'for this server'}</span> no longer exists on this Mac.</Callout>}
          {rt.job && (
            <Callout tone={rt.job.status === 'error' ? 'bad' : rt.job.status === 'done' ? 'ok' : 'brand'} icon={rt.job.status === 'running' ? <Loader2 className="animate-spin" /> : <Archive />}
              title={`${rt.job.type === 'restore' ? 'Restore' : 'Backup'}: ${rt.job.step}`}>
              {rt.job.error || (rt.job.bytes ? `${bytes(rt.job.bytes)} written` : rt.job.file)}
            </Callout>
          )}
          {recentCrash && <Callout tone="bad" icon={<ServerCrash />} title="The server stopped unexpectedly">Check the console for the error that caused it.{server.settings.restartOnCrash ? ' Auto-restart is on.' : ''}</Callout>}
          {rt.mode === 'external' && a.console > 1 && !rt.console && (
            <Callout tone="info" icon={<Terminal />} title="Started outside SquidPanel">
              This server was started by another app, so its console is read-only. Stop it and start it from here for full console control{a.role !== 'member' ? ', or enable RCON in Settings' : ''}.
            </Callout>
          )}
        </div>
        <Outlet context={{ server, reload } satisfies ServerCtx} />
      </div>
    </div>
  )
}
