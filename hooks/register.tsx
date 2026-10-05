import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { DayRow, Note, Rank, Report, Settings } from '../types'

const MINUTE = 60 * 1000
const DEFAULT_INTERVAL_MIN = 60
const DEFAULT_SNOOZE_MIN = 5
const DEFAULT_GOAL = 8 // glasses a day
const REPLY_MS = 5000

const ORANGE = '#D97757'
const BLUE = '#3BA7E0'

// ── Windows notification (shown even while Claude is minimized) ──
function notifyScript(isMuted: boolean): string {
  const audio = isMuted ? '<audio silent="true"/>' : '<audio src="ms-winsoundevent:Notification.Reminder"/>'
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text>Water break</text><text>Have you drunk water? Answer in Claude.</text></binding></visual>${audio}</toast>')`,
    '$t = [Windows.UI.Notifications.ToastNotification]::new($x)',
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($t)",
  ].join('; ')
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// PowerShell -EncodedCommand takes base64 of UTF-16LE.
function encodeCommand(script: string): string {
  const bytes: number[] = []
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i)
    bytes.push(c & 0xff, c >> 8)
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return out
}

// ── State ─────────────────────────────────────────────────────────
const isAsking = atom({ plugin: 'water-reminder', key: 'isAsking' } as const, false)
const isMuted = atom({ plugin: 'water-reminder', key: 'isMuted' } as const, false)
const nag = atom({ plugin: 'water-reminder', key: 'nag' } as const, 0)
const reply = atom({ plugin: 'water-reminder', key: 'reply' } as const, null as string | null)
// /water-stats runs this session, by their text
const reports = atom({ plugin: 'water-reminder', key: 'reports' } as const, {} as Record<string, Report>)
// other water commands' rows, by their text
const notes = atom({ plugin: 'water-reminder', key: 'notes' } as const, {} as Record<string, Note>)

// ── Critter sprite ────────────────────────────────────────────────
// An interactive Svg is drawn in its own frame; a frame whose colour scheme
// differs from the app's gets an opaque backdrop, so match whatever the app uses.
const SVG_TRANSPARENT =
  '<style>:root{color-scheme:light dark;background:transparent}html,body{margin:0;overflow:hidden;background:transparent}</style>'

const PX = 5
const COLORS: Record<string, string> = {
  L: '#EBA084', // body highlight
  O: ORANGE, // body
  D: '#B65A3C', // body shade / legs
  K: '#2A1A14', // eyes
  C: '#1E4E8C', // cap
  W: '#DDF1FB', // bottle glass
  H: '#FFFFFF', // glass shine
  B: BLUE, // water
  b: '#2783BC', // deep water
}
const BODY = [
  '..............CC..',
  '.............WWWW.',
  '..LLLLLLLL...WHWW.',
  '..LOOOOOOO...WHBW.',
  '..OOOOOOOO...WHBW.',
  '..OOOOOOOO...WBBW.',
  'LOOOOOOOOOOOOWBbW.',
  'ODDDDDDDDDDDOWBbW.',
  '..OOOOOOOO...WBbW.',
  '..DDDDDDDD...WWWW.',
  '..D.D..D.D........',
  '..D.D..D.D........',
]
const EYES: [number, number][] = [
  [3, 4],
  [3, 5],
  [8, 4],
  [8, 5],
]
const SPRITE_W = BODY[0].length * PX
const SPRITE_H = BODY.length * PX + 6

function px(x: number, y: number, fill: string): string {
  return `<rect x="${x * PX}" y="${y * PX}" width="${PX}" height="${PX}" fill="${fill}"/>`
}

const SPRITE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_W}" height="${SPRITE_H}" ` +
  `viewBox="0 -6 ${SPRITE_W} ${SPRITE_H}" shape-rendering="crispEdges" style="color-scheme:light dark">` +
  SVG_TRANSPARENT +
  // gentle bob
  '<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="1.8s" repeatCount="indefinite"/>' +
  BODY.flatMap((row, y) => [...row].map((c, x) => (COLORS[c] ? px(x, y, COLORS[c]) : ''))).join('') +
  // blinking eyes
  '<g>' +
  EYES.map(([x, y]) => px(x, y, COLORS.K)).join('') +
  '<animate attributeName="opacity" values="1;1;0;1" keyTimes="0;0.92;0.96;1" dur="4s" repeatCount="indefinite"/></g>' +
  '</g>' +
  // droplet sparkling above the bottle
  `<rect x="${15 * PX}" y="-5" width="3" height="3" fill="${BLUE}">` +
  '<animate attributeName="opacity" values="0;1;0" dur="1.8s" repeatCount="indefinite"/></rect>' +
  '</svg>'

const CRITTER_TEXT = [' ▐▛███▜▌  🧴', '▝▜█████▛▀▀ ', '  ▘▘ ▝▝    ']

// ── Copy ──────────────────────────────────────────────────────────
const ASKS = [
  'Time for a sip! Have you had some water?',
  'Gentle nudge: still no water?',
  'Your critter is getting worried… water please? 🥺',
  'The bottle is right here. Just one sip! 🙏',
]
const YES_REPLIES = ['Nice! 💧', 'Hydrated & happy! ✨', 'Great job! Your critter is proud. 🧡']

// ── Settings (shared by every session, see below) ─────────────────
let intervalMin = DEFAULT_INTERVAL_MIN
let snoozeMin = DEFAULT_SNOOZE_MIN
let isPaused = false
let goal = DEFAULT_GOAL
// Quiet hours as minutes after midnight, or null when off; start > end spans midnight
let quiet: { start: number; end: number } | null = null

function clockLabel(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function quietLabel(q: { start: number; end: number }): string {
  return `${clockLabel(q.start)} to ${clockLabel(q.end)}`
}

function isQuiet(t: number): boolean {
  if (!quiet) return false
  const d = new Date(t)
  const m = d.getHours() * 60 + d.getMinutes()
  return quiet.start < quiet.end ? m >= quiet.start && m < quiet.end : m >= quiet.start || m < quiet.end
}

// The first moment at or after `t` outside quiet hours
function afterQuiet(t: number): number {
  if (!quiet || !isQuiet(t)) return t
  const d = new Date(t)
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(quiet.end / 60), quiet.end % 60).getTime()
  return end > t ? end : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, Math.floor(quiet.end / 60), quiet.end % 60).getTime()
}

// "18:00-09:00", "18-9", "6:30 - 8" → minutes after midnight; undefined when not a window
function parseQuiet(args: string): { start: number; end: number } | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/.exec(args.trim())
  if (!m) return undefined
  const [h1, m1, h2, m2] = [Number(m[1]), Number(m[2] ?? 0), Number(m[3]), Number(m[4] ?? 0)]
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return undefined
  const start = h1 * 60 + m1
  const end = h2 * 60 + m2
  return start === end ? undefined : { start, end }
}

function minutes(n: number): string {
  if (n % 60 === 0) {
    const h = n / 60
    return h === 1 ? '1 hour' : `${h} hours`
  }
  return n === 1 ? '1 minute' : `${n} minutes`
}

// "/water-every 45" → 45; anything not a whole number from 1 to 1440 → undefined
function parseMinutes(args: string): number | undefined {
  const n = Number(args.trim())
  return Number.isInteger(n) && n >= 1 && n <= 1440 ? n : undefined
}

// ── Shared between every open session ─────────────────────────────
// Each session runs its own timers, so the schedule, the settings and the
// history live in files every session reads fresh: <claude config>/water-reminder/.
type Shared = {
  intervalMin?: number
  snoozeMin?: number
  paused?: boolean
  muted?: boolean
  goal?: number
  quiet?: { start: number; end: number } | null
  nextAt?: number | null // when the next question is due, null while paused or asking
  scheduledMs?: number // how long that wait was, for the status bar
  askedAt?: number // the latest question, from any session
  answeredAt?: number // the latest answer, from any session
  notifiedAt?: number // the latest Windows notification, so only one session sends it
}

let dataDir: string | undefined

async function sharedDir($: EngineInterface): Promise<string> {
  if (dataDir === undefined) {
    const config = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
    dataDir = `${(config ?? `${home}/.claude`).replace(/[\\/]+$/, '')}/water-reminder`
  }
  return dataDir
}

async function readJson($: EngineInterface, name: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(`${await sharedDir($)}/${name}`))
  } catch {
    return undefined
  }
}

async function readShared($: EngineInterface): Promise<Shared> {
  const value = await readJson($, 'shared.json')
  return value && typeof value === 'object' ? (value as Shared) : {}
}

async function writeShared($: EngineInterface, patch: Shared): Promise<Shared> {
  const next = { ...(await readShared($)), ...patch }
  await $.fs.write(`${await sharedDir($)}/shared.json`, JSON.stringify(next, null, 2))
  return next
}

// This session's settings, as every session should see them
async function saveSettings($: EngineInterface) {
  await writeShared($, { intervalMin, snoozeMin, goal, quiet, paused: isPaused, muted: await read($, isMuted) })
}

// Takes another session's settings
async function applySettings($: EngineInterface, s: Shared) {
  if (typeof s.intervalMin === 'number') intervalMin = s.intervalMin
  if (typeof s.snoozeMin === 'number') snoozeMin = s.snoozeMin
  if (typeof s.goal === 'number') goal = s.goal
  if (s.quiet !== undefined) quiet = s.quiet
  isPaused = s.paused === true
  if ((await read($, isMuted)) !== (s.muted === true)) {
    await update($, isMuted, () => s.muted === true)
  }
}

// ── History (shared by every session, in log.json) ────────────────
// One entry per answer: t = time, d = drank (true) or "Not yet" (false),
// n = how many times it had asked before this answer.
type LogEntry = { t: number; d: boolean; n: number }
const LOG_MAX = 5000
const DAY = 24 * 60 * MINUTE
const SPARK = '▁▂▃▄▅▆▇█'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FULL_DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const GLASS_ML = 250

async function readLog($: EngineInterface): Promise<LogEntry[]> {
  const shared = await readJson($, 'log.json')
  if (Array.isArray(shared)) {
    return shared as LogEntry[]
  }
  // before log.json: this copy's own history
  const stored = await $.store.get('log')
  return Array.isArray(stored) ? (stored as LogEntry[]) : []
}

async function record($: EngineInterface, drank: boolean, asks: number) {
  const log = await readLog($)
  log.push({ t: await $.clock.now(), d: drank, n: asks })
  await $.fs.write(`${await sharedDir($)}/log.json`, JSON.stringify(log.slice(-LOG_MAX)))
}

function dayKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

function since(min: number): string {
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ${min % 60}m ago`
  return `${Math.floor(min / (24 * 60))} days ago`
}

function rankFor(drinks: number, perDay: number, goal: number): Rank {
  const share = perDay / goal
  if (drinks === 0) return { emoji: '🌵', name: 'Cactus', blurb: 'no sips logged yet' }
  if (share >= 1) return { emoji: '🐋', name: 'Blue Whale', blurb: 'legendary hydration' }
  if (share >= 0.75) return { emoji: '🐬', name: 'Dolphin', blurb: 'swimming in it' }
  if (share >= 0.5) return { emoji: '🐟', name: 'Fish', blurb: 'solid and steady' }
  if (share >= 0.25) return { emoji: '🐸', name: 'Frog', blurb: 'getting there' }
  return { emoji: '🐪', name: 'Camel', blurb: 'running on reserves' }
}

function buildReport(log: LogEntry[], now: number, days: number, goal: number): Report {
  const today = new Date(now)
  const dayAt = (i: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)

  const drinksByDay = new Map<string, number>()
  const skipsByDay = new Map<string, number>()
  const hours: number[] = new Array(24).fill(0)
  const skipsByHour: number[] = new Array(24).fill(0)
  const byWeekday: number[] = new Array(7).fill(0)
  let drinks = 0
  let skips = 0
  let firstTry = 0
  for (const e of log) {
    const k = dayKey(e.t)
    const date = new Date(e.t)
    if (e.d) {
      drinks++
      if (e.n <= 1) firstTry++
      drinksByDay.set(k, (drinksByDay.get(k) ?? 0) + 1)
      hours[date.getHours()]++
      byWeekday[date.getDay()]++
    } else {
      skips++
      skipsByDay.set(k, (skipsByDay.get(k) ?? 0) + 1)
      skipsByHour[date.getHours()]++
    }
  }

  const rows: DayRow[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = dayAt(i)
    const k = dayKey(d.getTime())
    rows.push({
      label: `${WEEKDAYS[d.getDay()]} ${d.getDate()}`,
      drinks: drinksByDay.get(k) ?? 0,
      skips: skipsByDay.get(k) ?? 0,
      isToday: i === 0,
    })
  }

  // Streaks: days in a row with at least one drink (today counts once you drink)
  let streak = 0
  for (let i = (drinksByDay.get(dayKey(now)) ?? 0) > 0 ? 0 : 1; (drinksByDay.get(dayKey(dayAt(i).getTime())) ?? 0) > 0; i++) {
    streak++
  }
  const drinkDays = [...drinksByDay.keys()]
    .map(k => {
      const [y, m, d] = k.split('-').map(Number)
      return new Date(y, m - 1, d).getTime()
    })
    .sort((a, b) => a - b)
  let best = 0
  let run = 0
  for (let i = 0; i < drinkDays.length; i++) {
    run = i > 0 && Math.round((drinkDays[i] - drinkDays[i - 1]) / DAY) === 1 ? run + 1 : 1
    best = Math.max(best, run)
  }

  const windowDrinks = rows.reduce((a, r) => a + r.drinks, 0)
  const windowSkips = rows.reduce((a, r) => a + r.skips, 0)
  const activeDays = rows.filter(r => r.drinks + r.skips > 0).length
  const perDay = activeDays === 0 ? 0 : windowDrinks / activeDays
  const half = Math.floor(days / 2)
  const early = rows.slice(0, half).reduce((a, r) => a + r.drinks, 0)
  const late = rows.slice(days - half).reduce((a, r) => a + r.drinks, 0)
  const lastDrink = [...log].reverse().find(e => e.d)
  const first = dayAt(days - 1)

  return {
    days,
    goal,
    range: days === 1 ? 'today' : `${first.getDate()}/${first.getMonth() + 1} to ${today.getDate()}/${today.getMonth() + 1}`,
    rows,
    hours,
    today: rows[rows.length - 1],
    lastSip: lastDrink ? since(Math.round((now - lastDrink.t) / MINUTE)) : null,
    windowDrinks,
    windowSkips,
    litres: (windowDrinks * GLASS_ML) / 1000,
    perDay,
    trend: days < 2 ? null : late > early ? 'up' : late < early ? 'down' : 'flat',
    drinks,
    skips,
    yesRate: drinks + skips === 0 ? null : Math.round((drinks / (drinks + skips)) * 100),
    firstTryRate: drinks === 0 ? null : Math.round((firstTry / drinks) * 100),
    streak,
    best,
    thirstiest: drinks > 0 ? hourLabel(hours.indexOf(Math.max(...hours))) : null,
    bestDay: drinks > 0 ? FULL_DAYS[byWeekday.indexOf(Math.max(...byWeekday))] : null,
    snoozeHour: skips > 0 ? hourLabel(skipsByHour.indexOf(Math.max(...skipsByHour))) : null,
    snoozesPerSip: drinks > 0 && skips > 0 ? (skips / drinks).toFixed(1) : null,
    rank: rankFor(windowDrinks, perDay, goal),
  }
}

const TREND = { up: 'trending up', down: 'trending down', flat: 'holding steady' }

function insights(r: Report): string[] {
  return [
    r.thirstiest ? `You drink most around ${r.thirstiest}, and most on ${r.bestDay}.` : '',
    r.snoozeHour ? `"Not yet" comes up most around ${r.snoozeHour}. A bottle on the desk then might help.` : '',
    r.snoozesPerSip ? `${r.snoozesPerSip} snoozes per glass on average.` : '',
    r.firstTryRate !== null ? `Yes on the first ask ${r.firstTryRate}% of the time.` : '',
    r.trend ? `Second half of the period vs first: ${TREND[r.trend]}.` : '',
    `All time: ${r.drinks} glasses, ${r.skips} snoozes, best streak ${r.best} day${r.best === 1 ? '' : 's'}.`,
  ].filter(Boolean)
}

// The command's text: what the model reads, and the row drawn wherever the card below can't be
function reportText(r: Report): string {
  const BAR = 24
  const most = Math.max(1, ...r.rows.map(x => x.drinks + x.skips))
  const scale = most > BAR ? BAR / most : 1
  const width = Math.round(most * scale)
  const chart = r.rows.map(x => {
    const bar = '█'.repeat(Math.round(x.drinks * scale)) + '░'.repeat(Math.round(x.skips * scale))
    return `${x.label.padEnd(6)} │${bar.padEnd(width)} ${x.drinks} drank, ${x.skips} not yet`
  })
  const peak = Math.max(1, ...r.hours)
  const spark = r.hours.map(n => (n === 0 ? '·' : SPARK[Math.min(7, Math.floor((n / peak) * 7.99))])).join('')
  return [
    `### 💧 Hydration report · ${r.range}`,
    `**${r.rank.emoji} ${r.rank.name}**: ${r.rank.blurb}`,
    '',
    `**Today** ${r.today.drinks}/${r.goal} glasses · **Streak** 🔥 ${r.streak} · **Yes rate** ${r.yesRate ?? '-'}% · **Water** ≈ ${r.litres.toFixed(1)} L`,
    '',
    '```',
    ...chart,
    '',
    `00 ${spark} 23   sips by hour`,
    '```',
    ...insights(r).map(l => `- ${l}`),
  ].join('\n')
}

// ── Stats card (drawn in the transcript in place of the text) ─────
const INK = '#8A94A0'
const SKIP = '#9AA4AE'
const CHART_W = 560
const FONT = 'font-family="ui-monospace, SFMono-Regular, Consolas, monospace"'

type Pic = { source: string; width: number; height: number }

function svgOpen(w: number, h: number, viewBox = `0 0 ${w} ${h}`): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" ${FONT} style="background:transparent;color-scheme:light dark">${SVG_TRANSPARENT}`
}

// ── Drinking critter: lifts the bottle, tilts it to its face, drains it, lowers it
const BOTTLE = new Set(['C', 'W', 'H', 'B', 'b'])
const WATER = new Set(['B', 'b'])
const DRINK_DUR = '4s'
const DRINK_TIMES = '0;0.2;0.35;0.7;0.85;1'

function drinkingSvg(): Pic {
  const W = SPRITE_W + 10
  const H = SPRITE_H + 14
  const cells = (pick: (c: string) => boolean) =>
    BODY.flatMap((row, y) => [...row].map((c, x) => (pick(c) && COLORS[c] ? px(x, y, COLORS[c]) : ''))).join('')
  // water drains from the top while the bottle is tipped up
  const waterTop = 3 * PX
  const waterBottom = 9 * PX
  const pivot = `${15 * PX} ${5 * PX}`
  let s = svgOpen(W, H, `-4 -14 ${W} ${H}`).replace('<svg ', '<svg shape-rendering="crispEdges" ')
  s += `<defs><clipPath id="dk-water"><rect x="${13 * PX}" width="${4 * PX}" y="${waterTop}" height="${waterBottom - waterTop}">`
  // tipped cap-down, the water stays by the cap and shrinks away from the base
  const full = waterBottom - waterTop
  s += `<animate attributeName="height" values="${full};${full};${full};0;0;${full}" keyTimes="${DRINK_TIMES}" dur="${DRINK_DUR}" repeatCount="indefinite"/>`
  s += '</rect></clipPath></defs>'
  // body, with a small gulp while drinking
  s += '<g>'
  s += `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -1;0 0;0 -1;0 0;0 0" keyTimes="0;0.35;0.45;0.55;0.62;0.7;1" dur="${DRINK_DUR}" repeatCount="indefinite"/>`
  s += cells(c => !BOTTLE.has(c) && c !== 'K')
  // open eyes, swapped for squinting ones while drinking
  s += `<g>${EYES.map(([x, y]) => px(x, y, COLORS.K)).join('')}`
  s += `<animate attributeName="opacity" values="1;1;0;0;1;1" keyTimes="${DRINK_TIMES}" calcMode="discrete" dur="${DRINK_DUR}" repeatCount="indefinite"/></g>`
  s += `<g opacity="0">${px(2, 5, COLORS.K)}${px(3, 4, COLORS.K)}${px(4, 5, COLORS.K)}${px(7, 5, COLORS.K)}${px(8, 4, COLORS.K)}${px(9, 5, COLORS.K)}`
  s += `<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="${DRINK_TIMES}" calcMode="discrete" dur="${DRINK_DUR}" repeatCount="indefinite"/></g>`
  s += '</g>'
  // bottle: raised and tipped toward the face, then put back
  s += '<g>'
  s += `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;-4 -12;-4 -12;0 0;0 0" keyTimes="${DRINK_TIMES}" dur="${DRINK_DUR}" repeatCount="indefinite"/>`
  s += '<g>'
  s += `<animateTransform attributeName="transform" type="rotate" values="0 ${pivot};0 ${pivot};-125 ${pivot};-125 ${pivot};0 ${pivot};0 ${pivot}" keyTimes="${DRINK_TIMES}" dur="${DRINK_DUR}" repeatCount="indefinite"/>`
  s += cells(c => BOTTLE.has(c) && !WATER.has(c))
  s += `<g clip-path="url(#dk-water)">${cells(c => WATER.has(c))}</g>`
  s += '</g></g>'
  // a drop of satisfaction once it's done
  s += `<rect x="${5 * PX}" y="-6" width="4" height="4" fill="${BLUE}" opacity="0">`
  s += `<animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.7;0.78;0.95" dur="${DRINK_DUR}" repeatCount="indefinite"/>`
  s += `<animate attributeName="y" values="-2;-2;-8;-12" keyTimes="0;0.7;0.78;0.95" dur="${DRINK_DUR}" repeatCount="indefinite"/></rect>`
  return { source: s + '</svg>', width: W, height: H }
}

const DRINKING = drinkingSvg()

// ── Dancing critter (/water-version): steps, sways, shakes the bottle ─
const BEAT = '0.8s' // one step
const BAR = '1.6s' // left step + right step
const LEGS_LEFT = new Set(['2,10', '4,10', '2,11', '4,11'])
const LEGS_RIGHT = new Set(['7,10', '9,10', '7,11', '9,11'])

function danceSvg(): Pic {
  const W = SPRITE_W + 28
  const H = SPRITE_H + 26
  const cells = (pick: (c: string, x: number, y: number) => boolean) =>
    BODY.flatMap((row, y) => [...row].map((c, x) => (pick(c, x, y) && COLORS[c] ? px(x, y, COLORS[c]) : ''))).join('')
  const leg = (x: number, y: number) => LEGS_LEFT.has(`${x},${y}`) || LEGS_RIGHT.has(`${x},${y}`)
  const loop = 'repeatCount="indefinite"'
  // a pixel music note: head and stem, rising and fading
  const note = (x: number, delay: string) =>
    `<g opacity="0" fill="${BLUE}"><rect x="${x}" y="8" width="5" height="4"/><rect x="${x + 3}" y="0" width="2" height="9"/><rect x="${x + 3}" y="0" width="5" height="2"/>` +
    `<animate attributeName="opacity" values="0;1;0" dur="${BAR}" begin="${delay}" ${loop}/>` +
    `<animateTransform attributeName="transform" type="translate" values="0 2;0 -12" dur="${BAR}" begin="${delay}" ${loop}/></g>`

  let s = svgOpen(W, H, `-14 -22 ${W} ${H}`).replace('<svg ', '<svg shape-rendering="crispEdges" ')
  s += note(-12, '0s') + note(SPRITE_W + 4, '0.8s')
  // everything sways from foot to foot and bounces on every beat
  s += `<g><animateTransform attributeName="transform" type="rotate" values="-7 ${6 * PX} ${12 * PX};7 ${6 * PX} ${12 * PX};-7 ${6 * PX} ${12 * PX}" dur="${BAR}" ${loop}/>`
  s += `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="${BEAT}" ${loop}/>`
  // legs step in turn: left pair up on the first beat, right pair on the second
  s += `<g>${[...LEGS_LEFT].map(k => { const [x, y] = k.split(',').map(Number); return px(x, y, COLORS.D) }).join('')}`
  s += `<animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0;0 0;0 0" keyTimes="0;0.25;0.5;0.75;1" dur="${BAR}" ${loop}/></g>`
  s += `<g>${[...LEGS_RIGHT].map(k => { const [x, y] = k.split(',').map(Number); return px(x, y, COLORS.D) }).join('')}`
  s += `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 0;0 -4;0 0" keyTimes="0;0.25;0.5;0.75;1" dur="${BAR}" ${loop}/></g>`
  s += cells((c, x, y) => !BOTTLE.has(c) && c !== 'K' && !leg(x, y))
  // eyes: open, then happy ^ ^ on the second beat
  s += `<g>${EYES.map(([x, y]) => px(x, y, COLORS.K)).join('')}`
  s += `<animate attributeName="opacity" values="1;0" calcMode="discrete" dur="${BAR}" ${loop}/></g>`
  s += `<g opacity="0">${px(2, 5, COLORS.K)}${px(3, 4, COLORS.K)}${px(4, 5, COLORS.K)}${px(7, 5, COLORS.K)}${px(8, 4, COLORS.K)}${px(9, 5, COLORS.K)}`
  s += `<animate attributeName="opacity" values="0;1" calcMode="discrete" dur="${BAR}" ${loop}/></g>`
  // the bottle, shaken like a maraca
  s += `<g><animateTransform attributeName="transform" type="rotate" values="-22 ${15 * PX} ${9 * PX};18 ${15 * PX} ${9 * PX};-22 ${15 * PX} ${9 * PX}" dur="${BEAT}" ${loop}/>`
  s += cells(c => BOTTLE.has(c))
  s += '</g></g></g>'
  return { source: s + '</svg>', width: W, height: H }
}

const DANCING = danceSvg()

// Plain columns: drank in blue, "Not yet" stacked on top as an outline, today darker
function dayChartSvg(r: Report): Pic {
  const W = CHART_W
  const H = 150
  const top = 14
  const bottom = 20
  const n = r.rows.length
  const slot = W / n
  const barW = Math.max(2, Math.min(28, slot * 0.55))
  const most = Math.max(1, ...r.rows.map(x => x.drinks + x.skips))
  const y = (v: number) => (v / most) * (H - top - bottom)
  const base = H - bottom
  const every = Math.ceil(n / 8)
  let s = svgOpen(W, H)
  if (r.goal <= most) {
    const gy = base - y(r.goal)
    s += `<line x1="0" x2="${W}" y1="${gy}" y2="${gy}" stroke="${INK}" stroke-opacity="0.5" stroke-dasharray="2 3"/>`
    s += `<text x="${W}" y="${gy - 3}" text-anchor="end" font-size="9" fill="${INK}">goal ${r.goal}</text>`
  }
  r.rows.forEach((x, i) => {
    const cx = i * slot + slot / 2
    const bx = cx - barW / 2
    const dh = y(x.drinks)
    const sh = y(x.skips)
    if (x.skips > 0) {
      s += `<rect x="${bx + 0.5}" y="${base - dh - sh + 0.5}" width="${barW - 1}" height="${sh - 1}" fill="none" stroke="${SKIP}" stroke-opacity="0.7"/>`
    }
    if (x.drinks > 0) {
      s += `<rect x="${bx}" y="${base - dh}" width="${barW}" height="${dh}" fill="${x.isToday ? '#1E6FA8' : BLUE}"/>`
    }
    if (x.drinks > 0 && n <= 31) {
      s += `<text x="${cx}" y="${base - dh - sh - 4}" text-anchor="middle" font-size="10" fill="${INK}">${x.drinks}</text>`
    }
    if (i % every === 0 || x.isToday) {
      s += `<text x="${cx}" y="${H - 5}" text-anchor="middle" font-size="9.5" fill="${INK}"${x.isToday ? ' font-weight="700"' : ''}>${x.isToday ? 'today' : x.label.toLowerCase()}</text>`
    }
  })
  s += `<line x1="0" x2="${W}" y1="${base + 0.5}" y2="${base + 0.5}" stroke="${INK}" stroke-opacity="0.6"/>`
  return { source: s + '</svg>', width: W, height: H }
}

// 24 thin columns, one per hour
function hourChartSvg(r: Report): Pic {
  const W = CHART_W
  const H = 56
  const bottom = 16
  const slot = W / 24
  const peak = Math.max(1, ...r.hours)
  const base = H - bottom
  let s = svgOpen(W, H)
  r.hours.forEach((n, h) => {
    const bh = (n / peak) * (base - 4)
    if (n > 0) {
      s += `<rect x="${h * slot + slot * 0.3}" y="${base - bh}" width="${slot * 0.4}" height="${bh}" fill="${BLUE}"/>`
    }
    if (h % 6 === 0) {
      s += `<text x="${h * slot + slot / 2}" y="${H - 4}" text-anchor="middle" font-size="9.5" fill="${INK}">${hourLabel(h).slice(0, 2)}h</text>`
    }
  })
  s += `<line x1="0" x2="${W}" y1="${base + 0.5}" y2="${base + 0.5}" stroke="${INK}" stroke-opacity="0.6"/>`
  return { source: s + '</svg>', width: W, height: H }
}

function facts(r: Report): [string, string][] {
  const out: [string, string][] = []
  if (r.thirstiest) out.push(['peak hour', r.thirstiest])
  if (r.bestDay) out.push(['best day', r.bestDay.slice(0, -1)])
  if (r.firstTryRate !== null) out.push(['yes on first ask', `${r.firstTryRate}%`])
  if (r.snoozesPerSip) out.push(['snoozes per glass', r.snoozesPerSip])
  if (r.trend) out.push(['trend', { up: '↑ up', down: '↓ down', flat: '→ steady' }[r.trend]])
  out.push(['best streak', `${r.best} day${r.best === 1 ? '' : 's'}`])
  out.push(['all time', `${r.drinks} glass${r.drinks === 1 ? '' : 'es'} · ${r.skips} snooze${r.skips === 1 ? '' : 's'}`])
  return out
}

// A softly tinted panel of label / value pairs, three to a row
function factsSvg(r: Report): Pic {
  const W = CHART_W
  const pad = 18
  const cols = 3
  const rowH = 46
  const items = facts(r)
  const rows = Math.ceil(items.length / cols)
  const tip = r.snoozeHour ? `"Not yet" peaks around ${r.snoozeHour}. Keep a bottle within reach then.` : ''
  const H = pad + 18 + rows * rowH + (tip ? 22 : 0) + pad - 8
  const colW = (W - pad * 2) / cols
  const sans = 'font-family="system-ui, -apple-system, Segoe UI, sans-serif"'
  let s = svgOpen(W, H)
  s += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${BLUE}" fill-opacity="0.08"/>`
  s += `<text x="${pad}" y="${pad + 4}" font-size="10" letter-spacing="1.2" fill="${INK}">AT A GLANCE</text>`
  items.forEach(([label, value], i) => {
    const x = pad + (i % cols) * colW
    const y = pad + 18 + Math.floor(i / cols) * rowH
    s += `<text x="${x}" y="${y + 14}" font-size="11" fill="${INK}" ${sans}>${label}</text>`
    s += `<text x="${x}" y="${y + 34}" font-size="17" font-weight="600" fill="${BLUE}" ${sans}>${value}</text>`
  })
  if (tip) {
    s += `<text x="${pad}" y="${H - pad + 2}" font-size="11.5" font-style="italic" fill="${INK}" ${sans}>${tip.replace(/"/g, '&quot;')}</text>`
  }
  return { source: s + '</svg>', width: W, height: H }
}

// ── Timers ────────────────────────────────────────────────────────
const SYNC_MS = 5 * 1000
const SLACK_MS = 2000

let timer: Timer | undefined
let nextAt: number | undefined
let scheduledMs = 0
let replyTimer: Timer | undefined
let askedAtHere = 0 // when this session's band went up

// Shows the question here; `notify` also sends the Windows notification
async function ask($: EngineInterface, notify: boolean) {
  timer?.cancel()
  timer = undefined
  nextAt = undefined
  replyTimer?.cancel()
  askedAtHere = await $.clock.now()
  await update($, reply, () => null)
  await update($, nag, n => n + 1)
  await update($, isAsking, () => true)
  // a write from a timer can miss the band's redraw while a turn is streaming
  $.ui.invalidate('ui.render')
  if (notify) {
    const script = notifyScript(await read($, isMuted))
    void $.process
      .run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(script)])
      .catch(() => undefined)
  }
}

// Arms this session's timer for `at`, without telling the others
async function arm($: EngineInterface, at: number, waitMs: number) {
  timer?.cancel()
  nextAt = at
  scheduledMs = waitMs
  timer = $.clock.after(Math.max(0, at - (await $.clock.now())), () => void due($))
}

// Sets the next question `ms` from now, for every session
async function schedule($: EngineInterface, ms: number) {
  timer?.cancel()
  timer = undefined
  nextAt = undefined
  if (isPaused) {
    await writeShared($, { nextAt: null })
    return
  }
  const now = await $.clock.now()
  // a reminder that would land in quiet hours waits for them to end
  const at = afterQuiet(now + ms)
  await writeShared($, { nextAt: at, scheduledMs: at - now })
  await arm($, at, at - now)
}

// This session's timer went off: ask, unless another session moved the schedule
async function due($: EngineInterface) {
  // spread the sessions out a little so one of them claims the notification first
  await $.clock.sleep(Math.floor(Math.random() * 1500))
  const s = await readShared($)
  await applySettings($, s)
  const now = await $.clock.now()
  if (isPaused) {
    return
  }
  if (typeof s.nextAt === 'number' && s.nextAt > now + SLACK_MS) {
    await arm($, s.nextAt, s.scheduledMs ?? s.nextAt - now)
    return
  }
  if (isQuiet(now)) {
    // quiet hours began after this reminder was set: hold it until they end
    const at = afterQuiet(now)
    await writeShared($, { nextAt: at, scheduledMs: at - now })
    await arm($, at, at - now)
    return
  }
  const pending = (s.askedAt ?? 0) > (s.answeredAt ?? 0)
  const claimed = pending && (s.notifiedAt ?? 0) >= (s.askedAt ?? 0)
  if (!claimed) {
    await writeShared($, { askedAt: now, notifiedAt: now, nextAt: null })
  }
  await ask($, !claimed)
}

async function answer($: EngineInterface, drank: boolean) {
  await update($, isAsking, () => false)
  replyTimer?.cancel()
  const s = await readShared($)
  if ((s.answeredAt ?? 0) >= askedAtHere) {
    // already answered in another session: don't count it twice
    await update($, nag, () => 0)
    await update($, reply, () => 'Already answered in another session ✓')
    if (!isPaused && typeof s.nextAt === 'number') {
      await arm($, s.nextAt, s.scheduledMs ?? s.nextAt - (await $.clock.now()))
    }
    replyTimer = $.clock.after(REPLY_MS, () => void update($, reply, () => null))
    return
  }
  await record($, drank, await read($, nag))
  await writeShared($, { answeredAt: await $.clock.now() })
  if (drank) {
    await update($, nag, () => 0)
    const cheer = YES_REPLIES[Math.floor(Math.random() * YES_REPLIES.length)]
    await update($, reply, () => (isPaused ? cheer : `${cheer} See you in ${minutes(intervalMin)}.`))
    await schedule($, intervalMin * MINUTE)
  } else {
    await update($, reply, () => (isPaused ? 'OK, reminders are paused.' : `OK, I'll check back in ${minutes(snoozeMin)}. ⏳`))
    await schedule($, snoozeMin * MINUTE)
  }
  replyTimer?.cancel()
  replyTimer = $.clock.after(REPLY_MS, () => void update($, reply, () => null))
}

// Every few seconds: take what the other sessions changed
async function sync($: EngineInterface) {
  const s = await readShared($)
  await applySettings($, s)
  const asking = await read($, isAsking)
  const pending = (s.askedAt ?? 0) > (s.answeredAt ?? 0)
  if (isPaused) {
    timer?.cancel()
    timer = undefined
    nextAt = undefined
    return
  }
  if (asking && (s.answeredAt ?? 0) >= askedAtHere) {
    // answered in another session
    await update($, isAsking, () => false)
    await update($, nag, () => 0)
  } else if (!asking && pending && (s.askedAt ?? 0) > askedAtHere) {
    // asked in another session: show it here too, without a second notification
    await ask($, false)
    askedAtHere = s.askedAt ?? askedAtHere
    return
  }
  if (!(await read($, isAsking)) && typeof s.nextAt === 'number' && Math.abs(s.nextAt - (nextAt ?? 0)) > SLACK_MS) {
    await arm($, s.nextAt, s.scheduledMs ?? s.nextAt - (await $.clock.now()))
  }
}

// Starts this session from the shared schedule
async function startSchedule($: EngineInterface) {
  let s = await readShared($)
  if (typeof s.intervalMin !== 'number') {
    // first run with shared files: carry over this copy's own settings
    const storedInterval = await $.store.get('intervalMin')
    const storedSnooze = await $.store.get('snoozeMin')
    intervalMin = typeof storedInterval === 'number' ? storedInterval : DEFAULT_INTERVAL_MIN
    snoozeMin = typeof storedSnooze === 'number' ? storedSnooze : DEFAULT_SNOOZE_MIN
    isPaused = (await $.store.get('isPaused')) === true
    const storedMuted = (await $.store.get('isMuted')) === true
    await update($, isMuted, () => storedMuted)
    await saveSettings($)
    s = await readShared($)
  }
  await applySettings($, s)

  const now = await $.clock.now()
  const pending = (s.askedAt ?? 0) > (s.answeredAt ?? 0)
  if (isPaused) {
    // nothing to arm
  } else if (pending) {
    await ask($, false)
    askedAtHere = s.askedAt ?? now
  } else if (typeof s.nextAt === 'number' && s.nextAt > now) {
    await arm($, s.nextAt, s.scheduledMs ?? s.nextAt - now)
  } else {
    await schedule($, intervalMin * MINUTE)
  }
  $.clock.every(SYNC_MS, () => void sync($))
}

// ── Updates ───────────────────────────────────────────────────────
const PLUGIN_ID = 'water-reminder@claude-water-reminder'
const MARKETPLACE = 'claude-water-reminder'
const LATEST_MANIFEST = 'https://raw.githubusercontent.com/YossiAbutbul/claude-water-reminder/main/.claude-plugin/plugin.json'

// "0.10.1" vs "0.9.3": positive when a is newer
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

// `claude` is a .cmd shim on Windows, which only starts through cmd.exe
async function claudeCli($: EngineInterface, args: string[]) {
  const init = { timeoutMs: 3 * MINUTE }
  try {
    return await $.process.run(['claude', ...args], init)
  } catch {
    return await $.process.run(['cmd.exe', '/d', '/c', 'claude', ...args], init)
  }
}

function firstLine(text: string): string {
  return text.split('\n').map(l => l.trim()).find(Boolean) ?? ''
}

// ── Icons ─────────────────────────────────────────────────────────
// One style for every reply: a softly tinted tile with a line glyph in the
// reply's colour, drawn on a 24-unit grid. Keyed by the emoji the terminal
// shows in their place. Every glyph keeps moving while it is on screen.

const EASE = '0.45 0 0.55 1'

// One looping animation of `attr`; eased in and out unless `calc` says otherwise
function anim(attr: string, values: (string | number)[], dur: number, opts: { begin?: number; calc?: 'linear' | 'discrete'; keyTimes?: number[] } = {}): string {
  const tag = attr === 'translate' || attr === 'rotate' || attr === 'scale' ? `animateTransform attributeName="transform" type="${attr}"` : `animate attributeName="${attr}"`
  const steps = opts.calc === 'discrete' ? values.length : values.length - 1
  const keyTimes = opts.keyTimes ?? values.map((_, i) => +(i / steps).toFixed(4))
  const timing = opts.calc ? `calcMode="${opts.calc}"` : `calcMode="spline" keySplines="${Array(values.length - 1).fill(EASE).join(';')}"`
  return `<${tag} values="${values.join(';')}" keyTimes="${keyTimes.join(';')}" ${timing} dur="${dur}s"${opts.begin ? ` begin="${opts.begin}s"` : ''} repeatCount="indefinite"/>`
}

const SPEAKER = '<path d="M6.5 10h2.4L12.5 7v10l-3.6-3H6.5z"/>'
const TICKS = Array.from({ length: 12 }, (_, i) => `${i * 30} 12 12`)

const GLYPHS: Record<string, string> = {
  // the drop bobs and keeps sending ripples out beneath it
  '💧':
    `<ellipse cx="12" cy="19.4" rx="1" ry="0.4" stroke-width="1.2">${anim('rx', [1, 6.5], 1.8)}${anim('ry', [0.4, 1.5], 1.8)}${anim('opacity', [0.9, 0], 1.8)}</ellipse>` +
    `<path d="M12 5c2.8 3.4 4.8 6 4.8 8.6a4.8 4.8 0 0 1-9.6 0C7.2 11 9.2 8.4 12 5z" fill="currentColor" fill-opacity="0.25">${anim('translate', ['0 0', '0 -1.4', '0 0'], 1.8)}</path>`,
  // standby light: the sign slowly shrinks, dims and comes back
  '⏸️': `<g transform="translate(12 12)"><g>${anim('scale', [1, 0.82, 1], 2.6)}${anim('opacity', [1, 0.45, 1], 2.6)}<path d="M-2.5 -4v8M2.5 -4v8"/></g></g>`,
  // a ring spins around the play sign: running again
  '▶️':
    `<circle cx="12" cy="12" r="8" stroke-width="1.3" stroke-dasharray="14 36.3">${anim('rotate', ['0 12 12', '360 12 12'], 1.4, { calc: 'linear' })}</circle>` +
    `<path d="M10.2 8.6v6.8l5.3-3.4z" fill="currentColor" fill-opacity="0.25"/>`,
  // a ticking clock: the minute hand jumps each second, the hour hand creeps
  '🕒':
    `<circle cx="12" cy="12" r="7"/>` +
    `<path d="M12 12h2.8">${anim('rotate', ['0 12 12', '360 12 12'], 72, { calc: 'linear' })}</path>` +
    `<path d="M12 12V7.6">${anim('rotate', TICKS, 12, { calc: 'discrete' })}</path>` +
    `<circle cx="12" cy="12" r="0.7" fill="currentColor"/>`,
  // the hourglass flips, waits, flips again
  '⏳': `<g>${anim('rotate', ['0 12 12', '0 12 12', '180 12 12'], 2, { keyTimes: [0, 0.7, 1] })}<path d="M8.5 6h7M8.5 18h7M9.2 6.2c0 3.6 5.6 3.4 5.6 5.8s-5.6 2.2-5.6 5.8M14.8 6.2c0 3.6-5.6 3.4-5.6 5.8s5.6 2.2 5.6 5.8"/></g>`,
  // the sign wobbles and the dot blinks
  '⚠️': `<g>${anim('rotate', ['-5 12 17', '5 12 17', '-5 12 17'], 0.9)}<path d="M12 6.2l6.4 11.3H5.6z"/><path d="M12 10.6v3"/><circle cx="12" cy="15.6" r="0.6" fill="currentColor">${anim('opacity', [1, 0.2, 1], 0.9)}</circle></g>`,
  // the cross fades in and out
  '🔇': `${SPEAKER}<path d="M15.2 10l3.6 4M18.8 10l-3.6 4">${anim('opacity', [1, 0.25, 1], 1.6)}</path>`,
  // the waves pulse outward, one after the other
  '🔊': `${SPEAKER}<path d="M15.4 9.8a3.2 3.2 0 0 1 0 4.4">${anim('opacity', [0.25, 1, 0.25], 1.2)}</path><path d="M17.4 8a6 6 0 0 1 0 8">${anim('opacity', [0.25, 1, 0.25], 1.2, { begin: 0.3 })}</path>`,
  // the moon sways and its star twinkles
  '🌙':
    `<path d="M17.5 13.3A5.6 5.6 0 0 1 10.7 6.5a5.6 5.6 0 1 0 6.8 6.8z">${anim('rotate', ['-8 12 12', '8 12 12', '-8 12 12'], 3.2)}</path>` +
    `<path d="M17.2 5.6v2.4M16 6.8h2.4" stroke-width="1.2">${anim('opacity', [1, 0.15, 1], 1.4)}</path>`,
  // a ring keeps rippling out from the bullseye
  '🎯':
    `<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/>` +
    `<circle cx="12" cy="12" r="2.6" stroke-width="1">${anim('r', [2.6, 9], 1.6)}${anim('opacity', [0.9, 0], 1.6)}</circle>`,
  // the tick draws itself over and over
  '✅':
    `<circle cx="12" cy="12" r="6">${anim('r', [6, 6.5, 6], 2, { keyTimes: [0, 0.3, 1] })}</circle>` +
    `<path d="M9.4 12.2l1.8 1.8 3.6-3.8" pathLength="1" stroke-dasharray="1">${anim('stroke-dashoffset', [1, 0, 0, 1], 2, { keyTimes: [0, 0.3, 0.85, 1] })}</path>`,
  // the arrow keeps flying up through the tile
  '⬆️': `<path d="M12 17V7.5M8.2 11.2L12 7.4l3.8 3.8">${anim('translate', ['0 4', '0 -4'], 1.3, { calc: 'linear' })}${anim('opacity', [0, 1, 1, 0], 1.3, { keyTimes: [0, 0.3, 0.7, 1], calc: 'linear' })}</path>`,
}

// `size` in CSS pixels: about one row for a one-line reply, two for title + hint
function iconSvg(icon: string, color: string, size: number): string | undefined {
  const glyph = GLYPHS[icon]
  if (!glyph) return undefined
  // at one row, zoom in on the glyph and thicken it so it stays legible
  const small = size < 28
  const [box, tile, stroke] = small ? ['3 3 18 18', 'x="3.4" y="3.4" width="17.2" height="17.2" rx="4.5"', 2.1] : ['0 0 24 24', 'x="0.5" y="0.5" width="23" height="23" rx="6.5"', 1.7]
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${box}" style="color:${color};background:transparent;color-scheme:light dark">${SVG_TRANSPARENT}` +
    `<rect ${tile} fill="${color}" fill-opacity="0.14"/>` +
    `<g fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>` +
    '</svg>'
  )
}

// ── Command output rows ───────────────────────────────────────────
async function settings($: EngineInterface): Promise<Settings> {
  return { intervalMin, snoozeMin, goal, quiet: quiet ? quietLabel(quiet) : null, paused: isPaused, muted: await read($, isMuted) }
}

// Answers a command with `text` (what the model reads, and the fallback row)
// and keeps `note` so the row draws styled
async function say($: EngineInterface, text: string, note: Note) {
  await update($, notes, all => Object.fromEntries([...Object.entries(all).filter(([t]) => t !== text), [text, note]].slice(-40)))
  return { text }
}

function noteFor(all: Record<string, Note>, text: string): Note | undefined {
  return all[text] ?? Object.entries(all).find(([t]) => text.endsWith(t))?.[1]
}

function settingsLine(s: Settings): string {
  return `every ${minutes(s.intervalMin)} · "not yet" waits ${minutes(s.snoozeMin)} · goal ${s.goal} a day${s.quiet ? ` · quiet ${s.quiet}` : ''} · sound ${s.muted ? 'off' : 'on'}${s.paused ? ' · paused' : ''}`
}

type Els = ReturnType<EngineInterface['ui']['resolve']>

function drawNote(els: Els, note: Note) {
  const { Box, Text } = els
  const tone = (t: 'blue' | 'orange' | 'dim') => (t === 'blue' ? BLUE : t === 'orange' ? ORANGE : INK)

  if (note.kind === 'line') {
    // the icon spans the reply's rows: two with a hint, one without
    const size = note.hint ? 38 : 20
    const svg = iconSvg(note.icon, tone(note.tone), size)
    return (
      <Box key="water-note" flexDirection="row" gap={1} alignItems="center" paddingY={0}>
        {svg && 'Svg' in els ? <els.Svg source={svg} alt={note.icon} width={size} height={size} isInteractive /> : <Text>{note.icon}</Text>}
        <Box flexDirection="column">
          <Text bold color={tone(note.tone)}>
            {note.title}
          </Text>
          {note.hint ? <Text dimColor>{note.hint}</Text> : null}
        </Box>
      </Box>
    )
  }

  if (note.kind === 'about') {
    const critter =
      'Svg' in els ? (
        <els.Svg source={DANCING.source} alt="Claude critter dancing with its water bottle" width={DANCING.width} height={DANCING.height} isInteractive />
      ) : (
        <Box flexDirection="column">
          {CRITTER_TEXT.map((line, i) => (
            <Text key={`c${i}`} color={ORANGE}>
              {line}
            </Text>
          ))}
        </Box>
      )
    const link = note.repo.replace(/^https?:\/\//, '')
    return (
      <Box key="water-note" flexDirection="row" gap={2} alignItems="center" paddingY={1}>
        {critter}
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold color={BLUE}>
              water-reminder
            </Text>
            <Text dimColor>v{note.version}</Text>
          </Box>
          <Text>
            made by <Text bold color={ORANGE}>{note.author}</Text>
          </Text>
          {'Markdown' in els ? <els.Markdown key="repo" text={`[${link}](${note.repo})`} dimColor /> : <Text dimColor>{note.repo}</Text>}
          <Text dimColor>{note.copyright}</Text>
        </Box>
      </Box>
    )
  }

  // status
  {
    const BAR = 28
    const filled = Math.round(Math.min(1, Math.max(0, note.progress ?? 0)) * BAR)
    const critter =
      'Svg' in els ? (
        <els.Svg source={SPRITE_SVG} alt="Claude critter holding a water bottle" width={SPRITE_W} height={SPRITE_H} />
      ) : (
        <Box flexDirection="column">
          {CRITTER_TEXT.map((line, i) => (
            <Text key={`c${i}`} color={ORANGE}>
              {line}
            </Text>
          ))}
        </Box>
      )
    return (
      <Box key="water-note" flexDirection="row" gap={2} alignItems="center" paddingY={1}>
        {critter}
        <Box flexDirection="column">
          <Text dimColor>next water break</Text>
          {note.state === 'scheduled' ? (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Text bold color={BLUE}>
                  in {minutes(note.leftMin ?? 0)}
                </Text>
                <Text dimColor>at {note.at}</Text>
              </Box>
              <Box flexDirection="row">
                <Text color={BLUE}>{'━'.repeat(filled)}</Text>
                <Text dimColor>{'━'.repeat(BAR - filled)}</Text>
              </Box>
            </Box>
          ) : note.state === 'asking' ? (
            <Box flexDirection="column">
              <Text bold color={ORANGE}>
                now, waiting for your answer
              </Text>
              <Text dimColor>the question is just above the prompt</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text bold>paused</Text>
              <Text dimColor>/water-resume to start again</Text>
            </Box>
          )}
          <Text dimColor>{settingsLine(note.settings)}</Text>
        </Box>
      </Box>
    )
  }
}

async function redrawIfAsking($: EngineInterface) {
  if (await read($, isAsking)) {
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'water', description: 'Ask the water question now' })
    await $.command.register({ name: 'water-status', description: 'Show the next water reminder and settings' })
    await $.command.register({ name: 'water-pause', description: 'Pause water reminders' })
    await $.command.register({ name: 'water-resume', description: 'Resume water reminders' })
    await $.command.register({
      name: 'water-every',
      description: 'Set how often to remind, in minutes',
      argumentHint: '<minutes>',
    })
    await $.command.register({
      name: 'water-snooze',
      description: 'Set how long "Not yet" waits, in minutes',
      argumentHint: '<minutes>',
    })
    await $.command.register({
      name: 'water-stats',
      description: 'Chart and analysis of your water history',
      argumentHint: '[days]',
    })
    await $.command.register({
      name: 'water-quiet',
      description: 'Set quiet hours with no reminders, e.g. 18:00-09:00, or off',
      argumentHint: '<from>-<to> | off',
    })
    await $.command.register({
      name: 'water-goal',
      description: 'Set how many glasses a day you aim for',
      argumentHint: '<glasses>',
    })
    await $.command.register({ name: 'water-mute', description: 'Turn off the water reminder sound' })
    await $.command.register({ name: 'water-unmute', description: 'Turn on the water reminder sound' })
    await $.command.register({ name: 'water-help', description: 'List the water reminder commands' })
    await $.command.register({ name: 'water-update', description: 'Check for a new water-reminder version and install it' })
    await $.command.register({ name: 'water-version', description: 'Show the water-reminder version, its author and repo' })

    await startSchedule($)
    return next(e)
  })

  // keep a pending question on screen however the turn around it goes
  on('turn.start', async ($, e, next) => {
    await redrawIfAsking($)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await redrawIfAsking($)
    return result
  })

  on('command.run', { command: 'water' }, async $ => {
    const now = await $.clock.now()
    await writeShared($, { askedAt: now, notifiedAt: now, nextAt: null })
    await ask($, true)
    askedAtHere = now
    return say($, '💧 Water check is up above the prompt.', {
      kind: 'line',
      icon: '💧',
      title: 'Water check is up',
      hint: 'Answer it just above the prompt.',
      tone: 'blue',
    })
  })

  on('command.run', { command: 'water-status' }, async $ => {
    await sync($)
    const s = await settings($)
    if (isPaused) {
      return say($, '⏸️ Water reminders are paused. /water-resume to start again.', { kind: 'status', state: 'paused', settings: s })
    }
    if (nextAt === undefined) {
      return say($, '💧 Waiting for your answer to the water check above the prompt.', { kind: 'status', state: 'asking', settings: s })
    }
    const leftMs = Math.max(0, nextAt - (await $.clock.now()))
    const leftMin = Math.max(1, Math.round(leftMs / MINUTE))
    const at = new Date(nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const progress = scheduledMs > 0 ? 1 - leftMs / scheduledMs : 0
    return say(
      $,
      `💧 Next reminder at ${at} (in ${minutes(leftMin)})\nEvery ${minutes(s.intervalMin)} · "Not yet" waits ${minutes(s.snoozeMin)} · sound ${s.muted ? 'off' : 'on'}`,
      { kind: 'status', state: 'scheduled', at, leftMin, progress, settings: s },
    )
  })

  on('command.run', { command: 'water-pause' }, async $ => {
    isPaused = true
    await saveSettings($)
    await schedule($, 0)
    return say($, '⏸️ Water reminders paused. /water-resume to start again.', {
      kind: 'line',
      icon: '⏸️',
      title: 'Reminders paused',
      hint: '/water-resume to start again',
      tone: 'dim',
    })
  })

  on('command.run', { command: 'water-resume' }, async $ => {
    isPaused = false
    await saveSettings($)
    await schedule($, intervalMin * MINUTE)
    return say($, `▶️ Water reminders back on. Next one in ${minutes(intervalMin)}.`, {
      kind: 'line',
      icon: '▶️',
      title: 'Reminders back on',
      hint: `Next one in ${minutes(intervalMin)}`,
      tone: 'blue',
    })
  })

  on('command.run', { command: 'water-every' }, async ($, e) => {
    const n = parseMinutes(e.args)
    if (n === undefined) {
      return say($, `Usage: /water-every <minutes>, e.g. /water-every 45 (now every ${minutes(intervalMin)})`, {
        kind: 'line',
        icon: '⚠️',
        title: 'How often, in minutes?',
        hint: `e.g. /water-every 45 · now every ${minutes(intervalMin)}`,
        tone: 'orange',
      })
    }
    intervalMin = n
    await saveSettings($)
    await schedule($, n * MINUTE)
    return say($, `💧 Reminding every ${minutes(n)}${isPaused ? ' (paused, /water-resume to start)' : ''}.`, {
      kind: 'line',
      icon: '🕒',
      title: `Reminding every ${minutes(n)}`,
      hint: isPaused ? 'Paused for now, /water-resume to start' : `Next one in ${minutes(n)}`,
      tone: 'blue',
    })
  })

  on('command.run', { command: 'water-snooze' }, async ($, e) => {
    const n = parseMinutes(e.args)
    if (n === undefined) {
      return say($, `Usage: /water-snooze <minutes>, e.g. /water-snooze 10 (now ${minutes(snoozeMin)})`, {
        kind: 'line',
        icon: '⚠️',
        title: 'How long should "Not yet" wait, in minutes?',
        hint: `e.g. /water-snooze 10 · now ${minutes(snoozeMin)}`,
        tone: 'orange',
      })
    }
    snoozeMin = n
    await saveSettings($)
    return say($, `⏳ "Not yet" now waits ${minutes(n)}.`, {
      kind: 'line',
      icon: '⏳',
      title: `"Not yet" now waits ${minutes(n)}`,
      tone: 'blue',
    })
  })

  on('command.run', { command: 'water-goal' }, async ($, e) => {
    const n = Number(e.args.trim())
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      return say($, `Usage: /water-goal <glasses>, e.g. /water-goal 10 (1 to 30, now ${goal})`, {
        kind: 'line',
        icon: '⚠️',
        title: 'How many glasses a day?',
        hint: `e.g. /water-goal 10 · 1 to 30 · now ${goal}`,
        tone: 'orange',
      })
    }
    goal = n
    await saveSettings($)
    const today = dayKey(await $.clock.now())
    const drank = (await readLog($)).filter(x => x.d && dayKey(x.t) === today).length
    return say($, `🎯 Daily goal: ${n} glasses (≈ ${((n * GLASS_ML) / 1000).toFixed(1)} L). ${drank} so far today.`, {
      kind: 'line',
      icon: '🎯',
      title: `Daily goal: ${n} glasses`,
      hint: `≈ ${((n * GLASS_ML) / 1000).toFixed(1)} L a day · ${drank} so far today`,
      tone: 'blue',
    })
  })

  on('command.run', { command: 'water-quiet' }, async ($, e) => {
    const args = e.args.trim().toLowerCase()
    if (args === '') {
      return say($, quiet ? `🌙 Quiet hours: ${quietLabel(quiet)}.` : '🌙 No quiet hours set.', {
        kind: 'line',
        icon: '🌙',
        title: quiet ? `Quiet hours: ${quietLabel(quiet)}` : 'No quiet hours set',
        hint: quiet ? '/water-quiet off to remove them' : 'e.g. /water-quiet 18:00-09:00',
        tone: quiet ? 'blue' : 'dim',
      })
    }
    if (args === 'off') {
      quiet = null
      await saveSettings($)
      return say($, '🌙 Quiet hours off: reminders all day.', {
        kind: 'line',
        icon: '🌙',
        title: 'Quiet hours off',
        hint: 'Reminders come all day again',
        tone: 'dim',
      })
    }
    const window = parseQuiet(args)
    if (!window) {
      return say($, 'Usage: /water-quiet <from>-<to>, e.g. /water-quiet 18:00-09:00, or /water-quiet off', {
        kind: 'line',
        icon: '⚠️',
        title: 'Which hours should be quiet?',
        hint: 'e.g. /water-quiet 18:00-09:00 · /water-quiet 22-7 · /water-quiet off',
        tone: 'orange',
      })
    }
    quiet = window
    await saveSettings($)
    // a reminder already set inside the new window moves to its end
    const s = await readShared($)
    const now = await $.clock.now()
    if (!isPaused && typeof s.nextAt === 'number' && isQuiet(s.nextAt)) {
      const at = afterQuiet(s.nextAt)
      await writeShared($, { nextAt: at, scheduledMs: at - now })
      await arm($, at, at - now)
    }
    const label = quietLabel(window)
    return say($, `🌙 Quiet hours: ${label}. No reminders then.`, {
      kind: 'line',
      icon: '🌙',
      title: `Quiet hours: ${label}`,
      hint: 'No reminders then · /water-quiet off to remove',
      tone: 'blue',
    })
  })

  on('command.run', { command: 'water-stats' }, async ($, e) => {
    const n = e.args.trim() === '' ? 7 : Number(e.args.trim())
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      return say($, 'Usage: /water-stats [days], e.g. /water-stats 14 (1 to 90, default 7)', {
        kind: 'line',
        icon: '⚠️',
        title: 'How many days?',
        hint: 'e.g. /water-stats 14 · 1 to 90, default 7',
        tone: 'orange',
      })
    }
    const log = await readLog($)
    if (log.length === 0) {
      return say($, '💧 No water history yet. Answer a reminder (or run /water) and come back!', {
        kind: 'line',
        icon: '💧',
        title: 'No water history yet',
        hint: 'Answer a reminder (or run /water) and come back',
        tone: 'blue',
      })
    }
    const report = buildReport(log, await $.clock.now(), n, goal)
    const text = reportText(report)
    // keep the last few so their rows still draw as cards
    await update($, reports, all => Object.fromEntries([...Object.entries(all), [text, report]].slice(-20)))
    return { text }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'water-stats' } }, async ($, e, next) => {
    const all = await read($, reports)
    const r = all[e.props.text] ?? Object.entries(all).find(([t]) => e.props.text.endsWith(t))?.[1]
    if (!r) {
      const note = noteFor(await read($, notes), e.props.text)
      return note ? drawNote($.ui.resolve(e), note) : next(e)
    }

    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const hasSvg = 'Svg' in els

    const stat = (key: string, value: string, label: string) => (
      <Box key={key} flexDirection="column" minWidth={14}>
        <Text bold>{value}</Text>
        <Text dimColor>{label}</Text>
      </Box>
    )

    // terminal: one row per day, █ drank, ░ not yet
    const most = Math.max(1, ...r.rows.map(x => x.drinks + x.skips))
    const scale = most > 30 ? 30 / most : 1
    const textChart = (
      <Box flexDirection="column">
        {r.rows.map((x, i) => (
          <Box key={`d${i}`} flexDirection="row">
            <Text dimColor={!x.isToday} bold={x.isToday}>
              {(x.isToday ? 'today' : x.label.toLowerCase()).padEnd(7)}
            </Text>
            <Text color={BLUE}>{'█'.repeat(Math.round(x.drinks * scale))}</Text>
            <Text dimColor>{'░'.repeat(Math.round(x.skips * scale))}</Text>
            <Text dimColor>{x.drinks > 0 ? ` ${x.drinks}` : ''}</Text>
          </Box>
        ))}
      </Box>
    )
    const peak = Math.max(1, ...r.hours)
    const textHours = (
      <Box flexDirection="column">
        <Text color={BLUE}>{r.hours.map(n => (n === 0 ? ' ' : SPARK[Math.min(7, Math.floor((n / peak) * 7.99))])).join('')}</Text>
        <Text dimColor>00h   06h   12h   18h</Text>
      </Box>
    )

    const days = dayChartSvg(r)
    const hours = hourChartSvg(r)
    const factsPic = factsSvg(r)

    return (
      <Box key="water-stats" flexDirection="column" gap={1} paddingY={1}>
        <Box flexDirection="row" alignItems="flex-end" gap={2}>
          {hasSvg ? (
            <els.Svg source={DRINKING.source} alt="Claude critter drinking water" width={DRINKING.width} height={DRINKING.height} isInteractive />
          ) : (
            <Box flexDirection="column">
              {CRITTER_TEXT.map((line, i) => (
                <Text key={`c${i}`} color={ORANGE}>
                  {line}
                </Text>
              ))}
            </Box>
          )}
          <Box flexDirection="column">
            <Text bold>Hydration · {r.days === 1 ? 'today' : `last ${r.days} days`}</Text>
            <Text dimColor>
              {r.today.drinks} of {r.goal} glasses today{r.lastSip ? `, last one ${r.lastSip}` : ''} · rank: {r.rank.name.toLowerCase()} {r.rank.emoji}
            </Text>
          </Box>
        </Box>

        <Box flexDirection="row" gap={3} flexWrap="wrap">
          {stat('streak', `${r.streak} day${r.streak === 1 ? '' : 's'}`, `streak (best ${r.best})`)}
          {stat('yes', r.yesRate === null ? '-' : `${r.yesRate}%`, 'said yes')}
          {stat('water', `${r.litres.toFixed(1)} L`, `${r.windowDrinks} glasses`)}
          {stat('avg', r.perDay.toFixed(1), 'per day')}
          {stat('skips', String(r.windowSkips), 'not yet')}
        </Box>

        <Box flexDirection="column">
          <Text dimColor>glasses per day{r.windowSkips > 0 ? ' (outline = not yet)' : ''}</Text>
          {hasSvg ? <els.Svg source={days.source} alt="Glasses per day" width={days.width} height={days.height} /> : textChart}
        </Box>

        <Box flexDirection="column">
          <Text dimColor>by hour of day</Text>
          {hasSvg ? <els.Svg source={hours.source} alt="Glasses by hour of day" width={hours.width} height={hours.height} /> : textHours}
        </Box>

        {hasSvg ? (
          <els.Svg source={factsPic.source} alt={facts(r).map(([k, v]) => `${k}: ${v}`).join(', ')} width={factsPic.width} height={factsPic.height} />
        ) : (
          <Box flexDirection="column">
            <Text dimColor>at a glance</Text>
            {facts(r).map(([k, v], i) => (
              <Box key={`f${i}`} flexDirection="row">
                <Text dimColor>{k.padEnd(19)}</Text>
                <Text bold color={BLUE}>
                  {v}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  on('command.run', { command: 'water-help' }, async $ => {
    const muted = await read($, isMuted)
    return {
      text: [
        '### 💧 Water reminder commands',
        '',
        '| Command | What it does |',
        '|---|---|',
        '| `/water` | Ask the water question now |',
        '| `/water-status` | When the next reminder is due |',
        '| `/water-stats [days]` | Charts and analysis of your history (default 7 days, up to 90) |',
        '| `/water-every <minutes>` | How often to remind |',
        '| `/water-snooze <minutes>` | How long "Not yet" waits |',
        '| `/water-goal <glasses>` | Your daily goal (default 8) |',
        '| `/water-quiet <from>-<to>` · `off` | No reminders between those times, e.g. 18:00-09:00 |',
        '| `/water-pause` · `/water-resume` | Stop or restart reminders |',
        '| `/water-mute` · `/water-unmute` | Notification sound off or on |',
        '| `/water-update` | Check for a new version and install it |',
        '| `/water-version` | Version, author and repo |',
        '| `/water-help` | This list |',
        '',
        `Now: every ${minutes(intervalMin)} · "Not yet" waits ${minutes(snoozeMin)} · goal ${goal} a day · ${quiet ? `quiet ${quietLabel(quiet)}` : 'no quiet hours'} · ${isPaused ? 'paused' : 'running'} · sound ${muted ? 'off' : 'on'}`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'water-update' }, async $ => {
    let current = '0.0.0'
    try {
      current = String(JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version ?? current)
    } catch {
      // unreadable manifest: anything published counts as newer
    }

    let latest: string | undefined
    try {
      const res = await $.http.fetch(LATEST_MANIFEST)
      latest = res.ok ? String(JSON.parse(res.text).version) : undefined
    } catch {
      latest = undefined
    }
    if (latest === undefined) {
      return say($, "⚠️ Couldn't check for updates: GitHub didn't answer. Try again later.", {
        kind: 'line',
        icon: '⚠️',
        title: "Couldn't check for updates",
        hint: `GitHub didn't answer. You're on v${current}`,
        tone: 'orange',
      })
    }
    if (compareVersions(latest, current) <= 0) {
      return say($, `✅ water-reminder is up to date (v${current}).`, {
        kind: 'line',
        icon: '✅',
        title: `Up to date: v${current}`,
        hint: 'Nothing new on GitHub',
        tone: 'blue',
      })
    }

    const refreshed = await claudeCli($, ['plugin', 'marketplace', 'update', MARKETPLACE]).catch(() => undefined)
    const updated = await claudeCli($, ['plugin', 'update', PLUGIN_ID]).catch(() => undefined)
    if (refreshed?.exitCode !== 0 || updated?.exitCode !== 0) {
      const why = firstLine(updated?.stderr || updated?.stdout || refreshed?.stderr || '') || "the claude command didn't run"
      return say($, `⚠️ v${latest} is out but the update failed: ${why}\nRun it yourself: claude plugin update ${PLUGIN_ID}`, {
        kind: 'line',
        icon: '⚠️',
        title: `v${latest} is out, but the update failed`,
        hint: `${why} · run: claude plugin update ${PLUGIN_ID}`,
        tone: 'orange',
      })
    }
    return say($, `⬆️ Updated water-reminder v${current} → v${latest}. Start a new session to use it.`, {
      kind: 'line',
      icon: '⬆️',
      title: `Updated: v${current} → v${latest}`,
      hint: 'Start a new session to use it',
      tone: 'blue',
    })
  })

  on('command.run', { command: 'water-version' }, async $ => {
    let manifest: { version?: string; author?: { name?: string }; repository?: string; license?: string } = {}
    try {
      manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    } catch {
      // unreadable manifest: show what we can
    }
    const version = manifest.version ?? 'unknown'
    const author = manifest.author?.name ?? 'Yossi Abutbul'
    const repo = manifest.repository ?? 'https://github.com/YossiAbutbul/claude-water-reminder'
    const license = manifest.license ?? 'MIT'
    const copyright = `© 2026 ${author} · ${license} License`
    return say($, `💧 water-reminder v${version}\nMade by ${author}\n${repo}\n${copyright}`, {
      kind: 'about',
      version,
      author,
      repo,
      copyright,
    })
  })

  on('command.run', { command: 'water-mute' }, async $ => {
    await update($, isMuted, () => true)
    await saveSettings($)
    return say($, '🔇 Water reminder sound off.', { kind: 'line', icon: '🔇', title: 'Sound off', hint: 'Reminders still pop up, just quietly. /water-unmute to undo', tone: 'dim' })
  })

  on('command.run', { command: 'water-unmute' }, async $ => {
    await update($, isMuted, () => false)
    await saveSettings($)
    return say($, '🔊 Water reminder sound on.', { kind: 'line', icon: '🔊', title: 'Sound on', hint: 'Each reminder plays a chime again', tone: 'blue' })
  })

  // every water command's row except /water-stats' report, styled
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (!e.props.command.startsWith('water') || e.props.command === 'water-stats' || e.props.isErrored) {
      return next(e)
    }
    // the help table: drawn as markdown, the way an assistant reply is
    if (e.props.command === 'water-help') {
      const els = $.ui.resolve(e)
      return 'Markdown' in els ? <els.Markdown key="water-help" text={e.props.text.replace(/^water-reminder: /, "")} /> : next(e)
    }
    const note = noteFor(await read($, notes), e.props.text)
    return note ? drawNote($.ui.resolve(e), note) : next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const asking = await read($, isAsking)
    const said = await read($, reply)
    if (!asking && said === null) {
      return next(e)
    }

    const count = await read($, nag)
    const muted = await read($, isMuted)
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const hasSvg = 'Svg' in els

    const critter = hasSvg ? (
      <els.Svg
        source={SPRITE_SVG}
        alt="Claude critter holding a water bottle"
        width={SPRITE_W}
        height={SPRITE_H}
        isInteractive
      />
    ) : (
      <Box flexDirection="column">
        {CRITTER_TEXT.map((line, i) => (
          <Text key={`c${i}`} color={ORANGE}>
            {line}
          </Text>
        ))}
      </Box>
    )

    return (
      <Box
        key="water-card"
        flexDirection="row"
        gap={2}
        alignItems="center"
      >
        {critter}
        {asking ? (
          <Box flexDirection="column" flexGrow={1}>
            <Text bold color={BLUE}>
              💧 Hydration check{muted ? '  🔇' : ''}
            </Text>
            <Text>{ASKS[Math.min(count, ASKS.length) - 1] ?? ASKS[0]}</Text>
            <Box flexDirection="row" gap={1} marginTop={1}>
              <Button key="yes" label="Yes, I drank 💧" variant="primary" onPress={() => answer($, true)} />
              <Button key="no" label="Not yet" variant="secondary" onPress={() => answer($, false)} />
            </Box>
          </Box>
        ) : (
          <Box flexDirection="row" flexGrow={1} justifyContent="space-between" alignItems="center">
            <Text bold>{said}</Text>
            <Button key="close" label="Close" role="dismiss" onPress={() => update($, reply, () => null)} />
          </Box>
        )}
      </Box>
    )
  })
}
