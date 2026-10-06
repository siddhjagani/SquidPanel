/* eslint-disable react-refresh/only-export-components */
// SquidPanel UI kit: small, consistent primitives on top of Radix.
import * as React from 'react'
import * as DialogP from '@radix-ui/react-dialog'
import * as SwitchP from '@radix-ui/react-switch'
import * as TooltipP from '@radix-ui/react-tooltip'
import * as MenuP from '@radix-ui/react-dropdown-menu'
import * as CheckboxP from '@radix-ui/react-checkbox'
import { Check, ChevronDown, Copy, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn, copy } from '@/lib/format'

// ---------------- Button ----------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:bg-brand/90 shadow-[0_1px_0_0_rgb(255_255_255/0.15)_inset,0_6px_18px_-8px_rgb(var(--brand))]',
  secondary: 'bg-overlay text-fg hover:bg-line-strong/70 border border-line-strong/60',
  outline: 'border border-line-strong bg-transparent text-fg hover:bg-overlay',
  ghost: 'text-muted hover:text-fg hover:bg-overlay',
  danger: 'bg-bad/12 text-bad border border-bad/25 hover:bg-bad/20',
  success: 'bg-ok text-[#04130d] hover:bg-ok/90 shadow-[0_6px_18px_-8px_rgb(var(--ok))]',
}
const sizes: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-lg',
  'icon-sm': 'h-7 w-7 rounded-md',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant], sizes[size], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </button>
  )
})

// ---------------- Inputs ----------------
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode; right?: React.ReactNode }>(
  function Input({ className, icon, right, ...rest }, ref) {
    return (
      <div className={cn('group relative flex items-center', className)}>
        {icon && <span className="pointer-events-none absolute left-3 text-faint group-focus-within:text-muted [&_svg]:size-4">{icon}</span>}
        <input
          ref={ref}
          className={cn(
            'h-9 w-full rounded-lg border border-line-strong/70 bg-bg/60 px-3 text-sm text-fg placeholder:text-faint transition-colors',
            'hover:border-line-strong focus:border-brand/70 focus:bg-bg focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:opacity-50',
            icon && 'pl-9', right && 'pr-10',
          )}
          {...rest}
        />
        {right && <span className="absolute right-1.5">{right}</span>}
      </div>
    )
  },
)

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn('w-full rounded-lg border border-line-strong/70 bg-bg/60 px-3 py-2 text-sm text-fg placeholder:text-faint hover:border-line-strong focus:border-brand/70 focus:outline-none focus:ring-4 focus:ring-brand/10', className)}
      {...rest}
    />
  )
})

export function Select({ value, onChange, options, className, disabled }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; disabled?: boolean }) {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="h-9 w-full appearance-none rounded-lg border border-line-strong/70 bg-bg/60 pl-3 pr-9 text-sm text-fg hover:border-line-strong focus:border-brand/70 focus:outline-none focus:ring-4 focus:ring-brand/10 disabled:opacity-50"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
    </div>
  )
}

export function Label({ children, hint, htmlFor }: { children: React.ReactNode; hint?: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px] font-medium text-fg/90">
      <span>{children}</span>
      {hint && <span className="text-xs font-normal text-faint">{hint}</span>}
    </label>
  )
}

export function Field({ label, hint, help, children, className }: { label: React.ReactNode; hint?: React.ReactNode; help?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label hint={hint}>{label}</Label>
      {children}
      {help && <p className="mt-1.5 text-xs leading-relaxed text-faint">{help}</p>}
    </div>
  )
}

export function Switch({ checked, onChange, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  return (
    <SwitchP.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className={cn('relative shrink-0 rounded-full border border-line-strong bg-overlay transition-colors data-[state=checked]:border-brand data-[state=checked]:bg-brand disabled:opacity-40',
        size === 'sm' ? 'h-[18px] w-8' : 'h-[22px] w-10')}
    >
      <SwitchP.Thumb className={cn('block rounded-full bg-white shadow transition-transform', size === 'sm' ? 'size-3.5 translate-x-px data-[state=checked]:translate-x-[14px]' : 'size-[18px] translate-x-px data-[state=checked]:translate-x-[18px]')} />
    </SwitchP.Root>
  )
}

export function Checkbox({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <CheckboxP.Root
      checked={checked}
      onCheckedChange={v => onChange(v === true)}
      disabled={disabled}
      className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-bg/60 transition-colors data-[state=checked]:border-brand data-[state=checked]:bg-brand disabled:opacity-40"
    >
      <CheckboxP.Indicator><Check className="size-3.5 text-white" strokeWidth={3} /></CheckboxP.Indicator>
    </CheckboxP.Root>
  )
}

export function ToggleRow({ title, description, checked, onChange, disabled, children }: { title: React.ReactNode; description?: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</div>}
        {children}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

export function Segmented<T extends string | number>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[]; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('inline-flex rounded-lg border border-line-strong/70 bg-bg/60 p-0.5', className)}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn('flex-1 whitespace-nowrap rounded-md font-medium transition-colors', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
            value === o.value ? 'bg-overlay text-fg shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------- Surfaces ----------------
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-line bg-surface shadow-card', className)} {...rest}>{children}</div>
}

export function CardHeader({ title, description, actions, icon, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-overlay text-muted [&_svg]:size-4">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

const badgeTones = {
  neutral: 'bg-overlay text-muted border-line-strong/60',
  brand: 'bg-brand/12 text-[#b3a8ff] border-brand/25',
  ok: 'bg-ok/10 text-ok border-ok/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  bad: 'bg-bad/10 text-bad border-bad/25',
  info: 'bg-info/10 text-info border-info/25',
}
export function Badge({ tone = 'neutral', children, className, icon }: { tone?: keyof typeof badgeTones; children: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px text-2xs font-medium [&_svg]:size-3', badgeTones[tone], className)}>{icon}{children}</span>
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-overlay px-1.5 py-px font-mono text-[10px] text-muted">{children}</kbd>
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-shimmer rounded-lg bg-[linear-gradient(90deg,rgb(var(--raised))_0%,rgb(var(--overlay))_50%,rgb(var(--raised))_100%)] bg-[length:200%_100%]', className)} />
}

export function Empty({ icon, title, children, action, className }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-line-strong/60 bg-overlay text-muted [&_svg]:size-5">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Callout({ tone = 'info', icon, title, children, action, className }: { tone?: 'info' | 'warn' | 'bad' | 'ok' | 'brand'; icon?: React.ReactNode; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const tones = {
    info: 'border-info/25 bg-info/[0.06] text-info', warn: 'border-warn/25 bg-warn/[0.06] text-warn', bad: 'border-bad/25 bg-bad/[0.06] text-bad',
    ok: 'border-ok/25 bg-ok/[0.06] text-ok', brand: 'border-brand/30 bg-brand/[0.07] text-[#b3a8ff]',
  }
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3', tones[tone], className)}>
      {icon && <div className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</div>}
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className="text-fg/75">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

export function Progress({ value, tone = 'brand', className }: { value: number; tone?: 'brand' | 'ok' | 'warn' | 'bad'; className?: string }) {
  const colors = { brand: 'bg-brand', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-overlay', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', colors[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

// ---------------- Tooltip ----------------
export function Tip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return children
  return (
    <TooltipP.Root delayDuration={250}>
      <TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
      <TooltipP.Portal>
        <TooltipP.Content side={side} sideOffset={6} className="z-[100] max-w-xs animate-fade-in rounded-md border border-line-strong bg-overlay px-2 py-1 text-xs text-fg shadow-pop">
          {content}
        </TooltipP.Content>
      </TooltipP.Portal>
    </TooltipP.Root>
  )
}
export const TipProvider = TooltipP.Provider

// ---------------- Dialog ----------------
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md', icon }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: React.ReactNode; description?: React.ReactNode
  children?: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'; icon?: React.ReactNode
}) {
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-[min(1200px,96vw)]' }
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/65 backdrop-blur-[2px]" />
        <DialogP.Content
          className={cn('fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[calc(100vw-24px)] -translate-x-1/2 animate-pop-in flex-col rounded-2xl border border-line-strong bg-surface shadow-pop focus:outline-none', widths[size])}
          onOpenAutoFocus={e => { const el = (e.currentTarget as HTMLElement)?.querySelector<HTMLElement>('[data-autofocus]'); if (el) { e.preventDefault(); el.focus() } }}
        >
          <div className="flex items-start gap-3 px-5 pb-3 pt-5">
            {icon && <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-overlay text-muted [&_svg]:size-[18px]">{icon}</div>}
            <div className="min-w-0 flex-1">
              <DialogP.Title className="text-base font-semibold tracking-tight">{title}</DialogP.Title>
              {description ? <DialogP.Description className="mt-1 text-[13px] leading-relaxed text-muted">{description}</DialogP.Description> : <DialogP.Description className="sr-only">{String(title)}</DialogP.Description>}
            </div>
            <DialogP.Close className="-mr-1 -mt-1 rounded-md p-1.5 text-faint hover:bg-overlay hover:text-fg"><X className="size-4" /></DialogP.Close>
          </div>
          {children && <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-raised/40 px-5 py-3">{footer}</div>}
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  )
}

// Imperative confirm dialog: `const ok = await confirm({...})`.
interface ConfirmOpts { title: string; body?: React.ReactNode; confirmText?: string; tone?: 'danger' | 'primary'; typeToConfirm?: string }
type ConfirmFn = (o: ConfirmOpts) => Promise<boolean>
const ConfirmCtx = React.createContext<ConfirmFn>(async () => false)
export const useConfirm = () => React.useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const [typed, setTyped] = React.useState('')
  const confirm = React.useCallback<ConfirmFn>(o => new Promise(resolve => { setTyped(''); setState({ ...o, resolve }) }), [])
  const close = (v: boolean) => { state?.resolve(v); setState(null) }
  const blocked = !!state?.typeToConfirm && typed !== state.typeToConfirm
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog
        open={!!state}
        onOpenChange={v => { if (!v) close(false) }}
        title={state?.title}
        size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button variant={state?.tone === 'danger' ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(true)} data-autofocus={!state?.typeToConfirm || undefined}>{state?.confirmText || 'Confirm'}</Button>
        </>}
      >
        {state?.body && <div className="text-[13px] leading-relaxed text-muted">{state.body}</div>}
        {state?.typeToConfirm && (
          <div className="mt-4">
            <Label>Type <span className="font-mono text-fg">{state.typeToConfirm}</span> to confirm</Label>
            <Input data-autofocus value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !blocked) close(true) }} />
          </div>
        )}
      </Dialog>
    </ConfirmCtx.Provider>
  )
}

// ---------------- Menu ----------------
export const Menu = MenuP.Root
export const MenuTrigger = MenuP.Trigger
export function MenuContent({ children, align = 'end', className }: { children: React.ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <MenuP.Portal>
      <MenuP.Content align={align} sideOffset={6} className={cn('z-50 min-w-[190px] animate-pop-in rounded-xl border border-line-strong bg-raised p-1 shadow-pop', className)}>
        {children}
      </MenuP.Content>
    </MenuP.Portal>
  )
}
export function MenuItem({ children, icon, onSelect, danger, disabled, hint }: { children: React.ReactNode; icon?: React.ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean; hint?: React.ReactNode }) {
  return (
    <MenuP.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn('flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-overlay [&_svg]:size-4',
        danger ? 'text-bad data-[highlighted]:bg-bad/10' : 'text-fg/90')}
    >
      {icon && <span className={danger ? '' : 'text-muted'}>{icon}</span>}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </MenuP.Item>
  )
}
export const MenuSeparator = () => <MenuP.Separator className="my-1 h-px bg-line" />
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <MenuP.Label className="px-2.5 pb-1 pt-2 text-2xs font-medium uppercase tracking-wider text-faint">{children}</MenuP.Label>

// ---------------- Misc ----------------
export function CopyButton({ value, label, className, size = 'icon-sm' }: { value: string; label?: string; className?: string; size?: Size }) {
  const [done, setDone] = React.useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size={label ? 'xs' : size}
      className={className}
      onClick={async e => {
        e.stopPropagation()
        if (await copy(value)) { setDone(true); setTimeout(() => setDone(false), 1400) } else toast.error('Could not copy')
      }}
      icon={done ? <Check className="text-ok" /> : <Copy />}
    >
      {label && (done ? 'Copied' : label)}
    </Button>
  )
}

export function Stat({ label, value, sub, icon, accent, children, className }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; accent?: string; children?: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('relative overflow-hidden p-4', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{label}</span>
        {icon && <span className={cn('text-faint [&_svg]:size-4', accent)}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
      {children}
    </Card>
  )
}

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-faint">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function errorToast(e: unknown, fallback = 'Something went wrong') {
  toast.error((e as Error)?.message || fallback)
}
