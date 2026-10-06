import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Lock, ShieldAlert, User } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button, Callout, Field, Input } from '@/components/ui'
import { Logo } from '@/components/domain'

// Types a word, holds it, deletes it character by character, then types the next one.
const HOST_WORDS = ['Mac', 'Host', 'VM']
function Typewriter({ words = HOST_WORDS, typeMs = 110, deleteMs = 65, holdMs = 1800 }: { words?: string[]; typeMs?: number; deleteMs?: number; holdMs?: number }) {
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [index, setIndex] = useState(0)
  const [text, setText] = useState(words[0])
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (reduced) return
    const word = words[index]
    let t: ReturnType<typeof setTimeout>
    if (!deleting && text === word) t = setTimeout(() => setDeleting(true), holdMs)
    else if (deleting && text === '') t = setTimeout(() => { setDeleting(false); setIndex(i => (i + 1) % words.length) }, 300)
    else t = setTimeout(() => setText(deleting ? word.slice(0, text.length - 1) : word.slice(0, text.length + 1)), deleting ? deleteMs : typeMs)
    return () => clearTimeout(t)
  }, [text, deleting, index, words, reduced, typeMs, deleteMs, holdMs])

  if (reduced) return <span className="text-[#b3a8ff]">Host</span>
  return (
    <span aria-hidden className="whitespace-nowrap">
      <span className="bg-gradient-to-r from-[#c4bbff] to-brand bg-clip-text text-transparent">{text}</span>
      <span className="ml-0.5 inline-block h-[0.85em] w-[3px] translate-y-[0.1em] animate-caret rounded-full bg-brand" />
    </span>
  )
}

// Decorative isometric block cluster for the brand side.
function Blocks() {
  const cube = (x: number, y: number, top: string, left: string, right: string, delay: number) => (
    <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
      {/* CSS transforms replace the SVG transform attribute, so animate an inner group. */}
      <g style={{ animation: `float 7s ease-in-out ${delay}s infinite` }}>
        <path d="M0 -26 L45 0 L0 26 L-45 0 Z" fill={top} />
        <path d="M-45 0 L0 26 L0 78 L-45 52 Z" fill={left} />
        <path d="M45 0 L0 26 L0 78 L45 52 Z" fill={right} />
      </g>
    </g>
  )
  return (
    <svg viewBox="-200 -150 400 330" className="w-full max-w-[420px] drop-shadow-[0_30px_60px_rgba(132,116,255,0.25)]">
      {cube(-90, 26, '#6dd58c', '#5b3d26', '#4a301d', 0)}
      {cube(0, 78, '#6dd58c', '#5b3d26', '#4a301d', 0.4)}
      {cube(90, 26, '#a395ff', '#5b48f0', '#4535c9', 0.8)}
      {cube(0, -26, '#8a8f9c', '#5e636e', '#4d515b', 1.2)}
      {cube(0, -100, '#a395ff', '#5b48f0', '#4535c9', 1.6)}
    </svg>
  )
}

export default function AuthPage() {
  const { setup, refresh } = useAuth()
  const isSetup = !!setup?.needed
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (isSetup && password !== confirmPw) return setError('Passwords do not match')
    setBusy(true)
    try {
      if (isSetup) await api.post('/setup', { username, password, displayName })
      else await api.post('/auth/login', { username, password })
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-grid mask-fade-b opacity-60" />
        <div className="absolute -left-40 top-1/3 size-[520px] rounded-full bg-brand/20 blur-[120px]" />
        <div className="absolute -bottom-40 right-0 size-[380px] rounded-full bg-ok/10 blur-[110px]" />
        <div className="relative p-10"><Logo size={32} /></div>
        <div className="relative flex flex-1 items-center justify-center px-10"><Blocks /></div>
        <div className="relative p-10">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight" aria-label="Your Minecraft servers, running on your Host, controlled from anywhere.">
            {/* One clause per line so only the animated word moves. */}
            <span aria-hidden className="block">Your Minecraft servers,</span>
            <span aria-hidden className="block">running on your <Typewriter />,</span>
            <span aria-hidden className="block">controlled from anywhere.</span>
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">Start in seconds, sleep when empty, live console, backups and fine‑grained access for every friend.</p>
        </div>
      </div>

      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 lg:hidden"><Logo size={32} /></div>
          <h1 className="text-2xl font-semibold tracking-tight">{isSetup ? 'Create the owner account' : 'Welcome back'}</h1>
          <p className="mt-1.5 text-sm text-muted">{isSetup ? 'This account has full control over every server and every other account.' : 'Sign in to manage your servers.'}</p>

          {isSetup && !setup?.allowed ? (
            <Callout tone="warn" icon={<ShieldAlert />} title="Open this page on the Mac itself" className="mt-8">
              For safety the very first owner account can only be created from <span className="font-mono">http://localhost:3333</span> on the computer running SquidPanel — not through a tunnel or another device.
            </Callout>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-4">
              <Field label="Username">
                <Input autoFocus autoComplete="username" icon={<User />} value={username} onChange={e => setUsername(e.target.value)} placeholder="steve" required />
              </Field>
              {isSetup && (
                <Field label="Display name" hint="optional">
                  <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Steve" />
                </Field>
              )}
              <Field label="Password" hint={isSetup ? 'min 8 characters' : undefined}>
                <Input
                  type={show ? 'text' : 'password'}
                  autoComplete={isSetup ? 'new-password' : 'current-password'}
                  icon={<Lock />}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  right={<button type="button" tabIndex={-1} onClick={() => setShow(v => !v)} className="rounded-md p-1.5 text-faint hover:text-fg">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>}
                />
              </Field>
              {isSetup && (
                <Field label="Confirm password">
                  <Input type={show ? 'text' : 'password'} autoComplete="new-password" icon={<Lock />} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required />
                </Field>
              )}
              {error && <div className="rounded-lg border border-bad/25 bg-bad/[0.07] px-3 py-2 text-[13px] text-bad">{error}</div>}
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
                {isSetup ? 'Create account & continue' : 'Sign in'} {!busy && <ArrowRight />}
              </Button>
            </form>
          )}
          <p className="mt-10 text-center text-xs text-faint">Accounts are created by the server owner or an admin.</p>
        </div>
      </div>
    </div>
  )
}
