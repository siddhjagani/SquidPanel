import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ChevronRight, Download, Eraser, Lock, Search, Send, ShieldAlert, Terminal, WrapText } from 'lucide-react'
import { api, type LogLine } from '@/lib/api'
import { useConsole } from '@/lib/live'
import { useLocalState } from '@/lib/hooks'
import { parseAnsi, lineLevel, stripAnsi } from '@/lib/ansi'
import { cn } from '@/lib/format'
import { Button, Input, Segmented, Tip, errorToast } from '@/components/ui'
import { ConsoleBadge } from '@/components/domain'
import { useServer } from './Layout'

const COMMANDS = [
  'list', 'say ', 'tell ', 'msg ', 'time set day', 'time set night', 'weather clear', 'weather rain', 'gamemode survival ', 'gamemode creative ', 'gamemode spectator ',
  'tp ', 'give ', 'kick ', 'ban ', 'pardon ', 'whitelist add ', 'whitelist remove ', 'whitelist list', 'op ', 'deop ', 'save-all', 'difficulty ', 'gamerule ',
  'effect give ', 'xp add ', 'clear ', 'seed', 'tps', 'mspt', 'version', 'plugins', 'help', 'stop', 'spark tps', 'forge tps', 'neoforge tps',
]

// Stable per-line ids so trimming old lines never remounts the rest.
let seq = 0
type Row = LogLine & { id: number }
const tag = (ls: LogLine[]): Row[] => ls.map(l => ({ ...l, id: ++seq }))

const Line = memo(function Line({ e, wrap }: { e: LogLine; wrap: boolean }) {
  if (e.k === 'cmd') {
    return (
      <div className="flex items-baseline gap-2 py-px text-[#c4bbff]">
        <ChevronRight className="size-3 shrink-0 translate-y-[2px]" />
        <span className={cn(wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>{e.l.replace(/^> /, '')}</span>
        {e.u && <span className="ml-auto shrink-0 pl-3 text-[10px] text-faint">{e.u}</span>}
      </div>
    )
  }
  const level = lineLevel(e.l)
  const segs = parseAnsi(e.l)
  return (
    <div className={cn('py-px', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
      e.k === 'panel' ? 'text-[#a99dff]' : e.k === 'rcon' ? 'text-info' : level === 'error' ? 'text-[#ff9b9b]' : level === 'warn' ? 'text-[#f5cf6b]' : level === 'debug' ? 'text-faint' : 'text-[#cfd3dc]')}>
      {segs.map((s, i) => (
        <span key={i} style={s.color ? { color: s.color } : undefined} className={cn(s.bold && 'font-semibold', s.dim && 'opacity-60', s.italic && 'italic', s.underline && 'underline')}>{s.text}</span>
      ))}
    </div>
  )
})

export default function ConsolePage() {
  const { server } = useServer()
  const rt = server.runtime
  const level = server.access.console
  const [lines, setLines] = useState<Row[]>([])
  const [channel, setChannel] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<'all' | 'warn' | 'error'>('all')
  const [wrap, setWrap] = useLocalState('sp.console.wrap', true)
  const [follow, setFollow] = useState(true)
  const [unread, setUnread] = useState(0)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useLocalState<string[]>(`sp.history.${server.id}`, [])
  const [hIndex, setHIndex] = useState(-1)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const followRef = useRef(true)
  followRef.current = follow

  const onEvent = useCallback((ev: { type: 'init'; lines: LogLine[]; channel: string | null } | { type: 'lines'; lines: LogLine[] }) => {
    if (ev.type === 'init') { setLines(tag(ev.lines)); setChannel(ev.channel); setUnread(0); return }
    setLines(prev => {
      const next = prev.concat(tag(ev.lines))
      return next.length > 2500 ? next.slice(next.length - 2000) : next
    })
    if (!followRef.current) setUnread(u => u + ev.lines.length)
  }, [])
  useConsole(server.id, onEvent)
  useEffect(() => { setChannel(rt.console) }, [rt.console])

  const visible = useMemo(() => {
    const f = filter.toLowerCase()
    return lines.filter(e => {
      if (levelFilter !== 'all') {
        const lv = lineLevel(e.l)
        if (levelFilter === 'error' ? lv !== 'error' : lv !== 'warn' && lv !== 'error') return false
      }
      return !f || stripAnsi(e.l).toLowerCase().includes(f)
    })
  }, [lines, filter, levelFilter])

  useLayoutEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [visible, follow, wrap])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom !== follow) setFollow(atBottom)
    if (atBottom) setUnread(0)
  }

  const canType = level >= 2 && !!rt.pid && !!channel
  const placeholder = level < 2 ? 'Read-only access — you can watch but not type'
    : !rt.pid ? 'Server is offline'
    : !channel ? 'Console is read-only for servers started outside SquidPanel'
    : level === 2 ? 'Type a command… (restricted commands are blocked)' : 'Type a command…'

  const send = async (cmd = input) => {
    const c = cmd.trim()
    if (!c || !canType) return
    setSending(true)
    try {
      await api.post(`/servers/${server.id}/console`, { command: c })
      setHistory(h => [c, ...h.filter(x => x !== c)].slice(0, 60))
      setInput('')
      setHIndex(-1)
      setFollow(true)
    } catch (e) {
      errorToast(e)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const suggestions = useMemo(() => {
    const v = input.trim().toLowerCase()
    if (!v || v.includes(' ')) return []
    return [...new Set([...history.filter(h => h.toLowerCase().startsWith(v)), ...COMMANDS.filter(c => c.startsWith(v))])].filter(s => s.trim() !== v).slice(0, 6)
  }, [input, history])

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); send() }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const i = Math.min(hIndex + 1, history.length - 1)
      if (i >= 0) { setHIndex(i); setInput(history[i]) }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const i = hIndex - 1
      setHIndex(Math.max(-1, i))
      setInput(i >= 0 ? history[i] : '')
    } else if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault()
      setInput(suggestions[0])
    }
  }

  const exportLog = () => {
    const blob = new Blob([visible.map(e => stripAnsi(e.l)).join('\n')], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${server.id}-console-${new Date().toISOString().slice(0, 19)}.log`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const quick = level >= 2 ? ['list', 'save-all', 'time set day', 'weather clear', ...(rt.mode === 'managed' && server.software.match(/Paper|Purpur|Spigot/) ? ['tps'] : [])] : []

  return (
    <div className="flex h-[calc(100vh-260px)] min-h-[440px] flex-col overflow-hidden rounded-xl border border-line bg-[#06070a] shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface/70 px-3 py-2">
        <div className="flex items-center gap-2 pr-1">
          <Terminal className="size-4 text-muted" />
          <ConsoleBadge level={level} />
          {rt.pid && (
            <Tip content={channel === 'stdin' ? 'Commands go straight to the server process' : channel === 'rcon' ? 'Commands are sent over RCON' : 'This server was started by another app and RCON is off'}>
              <span className={cn('rounded-md px-1.5 py-px text-2xs', channel ? 'text-ok' : 'text-warn')}>● {channel === 'stdin' ? 'attached' : channel === 'rcon' ? 'rcon' : 'view only'}</span>
            </Tip>
          )}
        </div>
        <Input className="ml-auto w-full max-w-[220px] sm:w-56" icon={<Search />} placeholder="Filter output" value={filter} onChange={e => setFilter(e.target.value)} />
        <Segmented size="sm" value={levelFilter} onChange={setLevelFilter} options={[{ value: 'all', label: 'All' }, { value: 'warn', label: 'Warnings' }, { value: 'error', label: 'Errors' }]} />
        <Tip content={wrap ? 'Disable line wrap' : 'Wrap long lines'}><Button size="icon-sm" variant="ghost" className={wrap ? 'text-fg' : ''} onClick={() => setWrap(!wrap)}><WrapText /></Button></Tip>
        <Tip content="Download visible output"><Button size="icon-sm" variant="ghost" onClick={exportLog}><Download /></Button></Tip>
        <Tip content="Clear view (does not delete logs)"><Button size="icon-sm" variant="ghost" onClick={() => setLines([])}><Eraser /></Button></Tip>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="scrollbar-thin absolute inset-0 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-[1.6]">
          {visible.length ? visible.map(e => <Line key={e.id} e={e} wrap={wrap} />) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 font-sans text-sm text-faint">
              <Terminal className="size-6" />
              {lines.length ? 'No lines match your filter.' : rt.pid ? 'Waiting for output…' : 'The server is offline. Output appears here when it starts.'}
            </div>
          )}
        </div>
        {!follow && (
          <button onClick={() => { setFollow(true); setUnread(0) }}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3 py-1.5 text-xs font-medium shadow-pop hover:bg-overlay">
            <ArrowDown className="size-3.5" />{unread ? `${unread} new line${unread === 1 ? '' : 's'}` : 'Jump to latest'}
          </button>
        )}
      </div>

      <div className="border-t border-line bg-surface/70 p-2.5">
        {quick.length > 0 && rt.pid && channel && (
          <div className="mb-2 flex flex-wrap gap-1.5 px-0.5">
            {quick.map(c => <button key={c} onClick={() => send(c)} className="rounded-md border border-line-strong/70 bg-bg/60 px-2 py-0.5 font-mono text-[11px] text-muted hover:border-line-strong hover:text-fg">{c}</button>)}
          </div>
        )}
        <div className="relative">
          {suggestions.length > 0 && canType && (
            <div className="absolute bottom-full left-0 mb-2 w-72 overflow-hidden rounded-xl border border-line-strong bg-raised p-1 shadow-pop">
              {suggestions.map((s, i) => (
                <button key={s} onMouseDown={e => { e.preventDefault(); setInput(s); inputRef.current?.focus() }}
                  className={cn('flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-mono text-xs hover:bg-overlay', i === 0 && 'bg-overlay/60')}>
                  {s}{i === 0 && <span className="font-sans text-[10px] text-faint">Tab</span>}
                </button>
              ))}
            </div>
          )}
          <div className={cn('flex items-center gap-2 rounded-lg border bg-[#06070a] pl-3 pr-1.5 transition-colors', canType ? 'border-line-strong focus-within:border-brand/70 focus-within:ring-4 focus-within:ring-brand/10' : 'border-line')}>
            {canType ? <ChevronRight className="size-4 text-brand" /> : level < 2 ? <Lock className="size-4 text-faint" /> : <ShieldAlert className="size-4 text-faint" />}
            <input
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); setHIndex(-1) }}
              onKeyDown={onKey}
              disabled={!canType}
              placeholder={placeholder}
              spellCheck={false}
              autoComplete="off"
              className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-fg outline-none placeholder:font-sans placeholder:text-faint disabled:cursor-not-allowed"
            />
            <Button size="sm" variant={canType && input.trim() ? 'primary' : 'ghost'} disabled={!canType || !input.trim()} loading={sending} icon={<Send />} onClick={() => send()}>Send</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
