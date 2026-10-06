import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { Command } from 'cmdk'
import * as DialogP from '@radix-ui/react-dialog'
import {
  Activity, ChevronsUpDown, CircleStop, LayoutGrid, LogOut, Menu as MenuIcon, Play, Search, Settings, Terminal, User as UserIcon, Users, WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useLive } from '@/lib/live'
import { useServers } from '@/lib/servers'
import { useHotkey } from '@/lib/hooks'
import { cn } from '@/lib/format'
import { Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, errorToast } from './ui'
import { Logo, RoleBadge, ServerIcon, StatusDot, UserAvatar } from './domain'

function NavItem({ to, icon, children, end }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition-colors [&_svg]:size-4',
        isActive ? 'bg-overlay text-fg shadow-[inset_0_0_0_1px_rgb(var(--line-strong))]' : 'text-muted hover:bg-overlay/50 hover:text-fg')}
    >
      {icon}
      {children}
    </NavLink>
  )
}

function Sidebar({ onNavigate, onSearch }: { onNavigate?: () => void; onSearch: () => void }) {
  const { user, logout, isAdmin } = useAuth()
  const { servers } = useServers()
  const navigate = useNavigate()
  const online = servers.filter(s => s.runtime.status === 'online').length
  return (
    <div className="flex h-full flex-col" onClick={e => { if ((e.target as HTMLElement).closest('a')) onNavigate?.() }}>
      <div className="flex h-14 items-center px-4"><Logo /></div>
      <div className="px-3">
        <button onClick={onSearch} className="flex h-8 w-full items-center gap-2 rounded-lg border border-line-strong/60 bg-bg/50 px-2.5 text-[13px] text-faint transition-colors hover:border-line-strong hover:text-muted">
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
      <nav className="mt-4 space-y-0.5 px-3">
        <NavItem to="/" end icon={<LayoutGrid />}>Dashboard</NavItem>
        <NavItem to="/activity" icon={<Activity />}>Activity</NavItem>
        {isAdmin && <NavItem to="/users" icon={<Users />}>Users &amp; access</NavItem>}
        {isAdmin && <NavItem to="/settings" icon={<Settings />}>Panel settings</NavItem>}
      </nav>
      <div className="mt-6 flex items-center justify-between px-5 pb-1.5">
        <span className="text-2xs font-semibold uppercase tracking-wider text-faint">Servers</span>
        <span className="text-2xs text-faint tabular">{online}/{servers.length} online</span>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        {servers.map(s => (
          <NavLink
            key={s.id}
            to={`/servers/${s.id}`}
            className={({ isActive }) => cn('group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors', isActive ? 'bg-overlay shadow-[inset_0_0_0_1px_rgb(var(--line-strong))]' : 'hover:bg-overlay/50')}
          >
            <ServerIcon server={s} size={26} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{s.name}</div>
              <div className="truncate text-2xs text-faint">{s.software} {s.mcVersion}</div>
            </div>
            <div className="flex items-center gap-1.5">
              {s.runtime.players.length > 0 && <span className="text-2xs font-medium text-ok tabular">{s.runtime.players.length}</span>}
              <StatusDot status={s.runtime.status} />
            </div>
          </NavLink>
        ))}
        {!servers.length && <div className="px-2 py-3 text-xs leading-relaxed text-faint">{isAdmin ? 'No servers yet. Add one from Panel settings.' : 'Nothing shared with you yet. Ask an admin for access.'}</div>}
      </div>
      <div className="border-t border-line p-3">
        <Menu>
          <MenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-overlay">
              <UserAvatar name={user!.displayName} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{user!.displayName}</div>
                <div className="truncate text-2xs text-faint">@{user!.username} · {user!.role}</div>
              </div>
              <ChevronsUpDown className="size-4 text-faint" />
            </button>
          </MenuTrigger>
          <MenuContent align="start" className="w-[220px]">
            <MenuLabel>Signed in as {user!.username}</MenuLabel>
            <div className="px-2.5 pb-2"><RoleBadge role={user!.role} /></div>
            <MenuSeparator />
            <MenuItem icon={<UserIcon />} onSelect={() => { navigate('/account'); onNavigate?.() }}>Account &amp; security</MenuItem>
            <MenuItem icon={<LogOut />} onSelect={logout}>Sign out</MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </div>
  )
}

function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { servers, reload } = useServers()
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const go = (to: string) => { onOpenChange(false); navigate(to) }
  const power = async (id: string, action: 'start' | 'stop') => {
    onOpenChange(false)
    try { await api.post(`/servers/${id}/${action}`); toast.success(action === 'start' ? 'Starting server…' : 'Stopping server…'); reload() } catch (e) { errorToast(e) }
  }
  const item = 'flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-fg/90 data-[selected=true]:bg-overlay [&_svg]:size-4 [&_svg]:text-muted'
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/60 backdrop-blur-[2px]" />
        <DialogP.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 animate-pop-in overflow-hidden rounded-2xl border border-line-strong bg-raised shadow-pop">
          <DialogP.Title className="sr-only">Command palette</DialogP.Title>
          <DialogP.Description className="sr-only">Jump to servers and pages</DialogP.Description>
          <Command loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="size-4 text-faint" />
              <Command.Input autoFocus placeholder="Jump to a server, page or action…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-faint">No results.</Command.Empty>
              <Command.Group heading="Servers" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint">
                {servers.map(s => (
                  <Command.Item key={s.id} value={`server ${s.name}`} onSelect={() => go(`/servers/${s.id}`)} className={item}>
                    <ServerIcon server={s} size={20} />
                    <span className="flex-1">{s.name}</span>
                    <StatusDot status={s.runtime.status} />
                  </Command.Item>
                ))}
                {servers.filter(s => s.access.console > 0).map(s => (
                  <Command.Item key={s.id + 'c'} value={`console ${s.name}`} onSelect={() => go(`/servers/${s.id}/console`)} className={item}>
                    <Terminal /> <span>Open console — {s.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint">
                {servers.filter(s => s.runtime.status === 'offline' && s.access.perms.includes('power.start')).map(s => (
                  <Command.Item key={s.id + 'start'} value={`start ${s.name}`} onSelect={() => power(s.id, 'start')} className={item}><Play /> Start {s.name}</Command.Item>
                ))}
                {servers.filter(s => s.runtime.status === 'online' && s.access.perms.includes('power.stop')).map(s => (
                  <Command.Item key={s.id + 'stop'} value={`stop ${s.name}`} onSelect={() => power(s.id, 'stop')} className={item}><CircleStop /> Stop {s.name}</Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Pages" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint">
                <Command.Item onSelect={() => go('/')} className={item}><LayoutGrid /> Dashboard</Command.Item>
                <Command.Item onSelect={() => go('/activity')} className={item}><Activity /> Activity log</Command.Item>
                {isAdmin && <Command.Item onSelect={() => go('/users')} className={item}><Users /> Users &amp; access</Command.Item>}
                {isAdmin && <Command.Item onSelect={() => go('/settings')} className={item}><Settings /> Panel settings</Command.Item>}
                <Command.Item onSelect={() => go('/account')} className={item}><UserIcon /> Account &amp; security</Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  )
}

export default function Shell({ children }: { children: ReactNode }) {
  const [mobile, setMobile] = useState(false)
  const [palette, setPalette] = useState(false)
  const live = useLive()
  useHotkey('k', e => { e.preventDefault(); setPalette(v => !v) }, { meta: true })
  // Only show the offline banner after a short grace period (avoids flashes on reconnect).
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => {
    if (live.connected) return
    const t = setTimeout(() => setGraceOver(true), 2500)
    return () => { clearTimeout(t); setGraceOver(false) }
  }, [live.connected])
  const showOffline = !live.connected && graceOver

  return (
    <div className="flex h-full">
      <aside className="hidden w-[248px] shrink-0 border-r border-line bg-surface/60 lg:block">
        <Sidebar onSearch={() => setPalette(true)} />
      </aside>
      <DialogP.Root open={mobile} onOpenChange={setMobile}>
        <DialogP.Portal>
          <DialogP.Overlay className="fixed inset-0 z-40 animate-fade-in bg-black/60 lg:hidden" />
          <DialogP.Content className="fixed inset-y-0 left-0 z-50 w-[272px] animate-slide-in border-r border-line bg-surface lg:hidden">
            <DialogP.Title className="sr-only">Navigation</DialogP.Title>
            <DialogP.Description className="sr-only">Main navigation</DialogP.Description>
            <Sidebar onNavigate={() => setMobile(false)} onSearch={() => { setMobile(false); setPalette(true) }} />
          </DialogP.Content>
        </DialogP.Portal>
      </DialogP.Root>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 lg:hidden">
          <button onClick={() => setMobile(true)} className="rounded-lg p-1.5 text-muted hover:bg-overlay" aria-label="Open menu"><MenuIcon className="size-5" /></button>
          <Logo size={24} />
          <button onClick={() => setPalette(true)} className="ml-auto rounded-lg p-1.5 text-muted hover:bg-overlay" aria-label="Search"><Search className="size-5" /></button>
        </header>
        {showOffline && (
          <div className="flex items-center justify-center gap-2 border-b border-warn/20 bg-warn/[0.07] px-4 py-1.5 text-xs text-warn">
            <WifiOff className="size-3.5" /> Live connection lost — reconnecting…
          </div>
        )}
        <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <Palette open={palette} onOpenChange={setPalette} />
    </div>
  )
}
