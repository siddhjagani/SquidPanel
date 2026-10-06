// ANSI SGR + Minecraft § colour codes -> styled segments for the console.
export interface Seg { text: string; color?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }

const ANSI: Record<number, string> = {
  30: '#5b6273', 31: '#f87171', 32: '#4ade80', 33: '#facc15', 34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#e5e7eb',
  90: '#8a91a3', 91: '#fca5a5', 92: '#86efac', 93: '#fde68a', 94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#ffffff',
}
const MC: Record<string, string> = {
  '0': '#5b6273', '1': '#3b5bdb', '2': '#2f9e44', '3': '#0ca5b0', '4': '#e03131', '5': '#ae3ec9', '6': '#f59f00', '7': '#adb5bd',
  '8': '#868e96', '9': '#748ffc', a: '#69db7c', b: '#66d9e8', c: '#ff8787', d: '#f783ac', e: '#ffe066', f: '#ffffff',
}

function xterm256(n: number) {
  if (n < 16) return ANSI[n < 8 ? 30 + n : 82 + n]
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})` }
  n -= 16
  const c = (x: number) => (x ? 55 + x * 40 : 0)
  return `rgb(${c(Math.floor(n / 36))},${c(Math.floor((n % 36) / 6))},${c(n % 6)})`
}

export function parseAnsi(input: string): Seg[] {
  const out: Seg[] = []
  let cur: Seg = { text: '' }
  const push = () => { if (cur.text) out.push(cur); cur = { ...cur, text: '' } }
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m|§([0-9a-fk-or])/gi
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    cur.text += input.slice(last, m.index)
    last = re.lastIndex
    push()
    if (m[2]) {
      const c = m[2].toLowerCase()
      if (MC[c]) cur = { text: '', color: MC[c] }
      else if (c === 'l') cur.bold = true
      else if (c === 'o') cur.italic = true
      else if (c === 'n') cur.underline = true
      else if (c === 'r') cur = { text: '' }
      continue
    }
    const codes = (m[1] || '0').split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) cur = { text: '' }
      else if (c === 1) cur.bold = true
      else if (c === 2) cur.dim = true
      else if (c === 3) cur.italic = true
      else if (c === 4) cur.underline = true
      else if (c === 22) { cur.bold = false; cur.dim = false }
      else if (c === 39) cur.color = undefined
      else if (ANSI[c]) cur.color = ANSI[c]
      else if (c === 38 && codes[i + 1] === 5) { cur.color = xterm256(codes[i + 2]); i += 2 }
      else if (c === 38 && codes[i + 1] === 2) { cur.color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4 }
    }
  }
  cur.text += input.slice(last)
  push()
  return out
}

// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m|§[0-9a-fk-or]/gi, '')

export function lineLevel(s: string): 'error' | 'warn' | 'info' | 'debug' | null {
  if (/\/(ERROR|FATAL)\]|\bERROR\]:|\[ERROR\]|Exception|^\s+at [\w.$]+\(/.test(s)) return 'error'
  if (/\/WARN\]|\bWARN\]:|\[WARN\]/.test(s)) return 'warn'
  if (/\/DEBUG\]|\[DEBUG\]/.test(s)) return 'debug'
  if (/INFO\]/.test(s)) return 'info'
  return null
}
