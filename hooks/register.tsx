import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

const MINUTE = 60 * 1000
const DEFAULT_INTERVAL_MIN = 60
const DEFAULT_SNOOZE_MIN = 5
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

// ── Critter sprite ────────────────────────────────────────────────
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
  `viewBox="0 -6 ${SPRITE_W} ${SPRITE_H}" shape-rendering="crispEdges">` +
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
  'Gentle nudge — still no water?',
  'Your critter is getting worried… water please? 🥺',
  'The bottle is right here. Just one sip! 🙏',
]
const YES_REPLIES = ['Nice! 💧', 'Hydrated & happy! ✨', 'Great job! Your critter is proud. 🧡']

// ── Settings (kept across sessions in $.store) ────────────────────
let intervalMin = DEFAULT_INTERVAL_MIN
let snoozeMin = DEFAULT_SNOOZE_MIN
let isPaused = false

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

// ── Timers ────────────────────────────────────────────────────────
let timer: Timer | undefined
let nextAt: number | undefined
let replyTimer: Timer | undefined

async function ask($: EngineInterface) {
  timer?.cancel()
  nextAt = undefined
  replyTimer?.cancel()
  await update($, reply, () => null)
  await update($, nag, n => n + 1)
  await update($, isAsking, () => true)
  const script = notifyScript(await read($, isMuted))
  void $.process
    .run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand(script)])
    .catch(() => undefined)
}

async function schedule($: EngineInterface, ms: number) {
  timer?.cancel()
  timer = undefined
  nextAt = undefined
  if (isPaused) {
    return
  }
  nextAt = (await $.clock.now()) + ms
  timer = $.clock.after(ms, () => void ask($))
}

async function answer($: EngineInterface, drank: boolean) {
  await update($, isAsking, () => false)
  if (drank) {
    await update($, nag, () => 0)
    const cheer = YES_REPLIES[Math.floor(Math.random() * YES_REPLIES.length)]
    await update($, reply, () => (isPaused ? cheer : `${cheer} See you in ${minutes(intervalMin)}.`))
    await schedule($, intervalMin * MINUTE)
  } else {
    await update($, reply, () => (isPaused ? 'OK — reminders are paused.' : `OK — I'll check back in ${minutes(snoozeMin)}. ⏳`))
    await schedule($, snoozeMin * MINUTE)
  }
  replyTimer?.cancel()
  replyTimer = $.clock.after(REPLY_MS, () => void update($, reply, () => null))
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
    await $.command.register({ name: 'water-mute', description: 'Turn off the water reminder sound' })
    await $.command.register({ name: 'water-unmute', description: 'Turn on the water reminder sound' })

    const storedInterval = await $.store.get('intervalMin')
    const storedSnooze = await $.store.get('snoozeMin')
    intervalMin = typeof storedInterval === 'number' ? storedInterval : DEFAULT_INTERVAL_MIN
    snoozeMin = typeof storedSnooze === 'number' ? storedSnooze : DEFAULT_SNOOZE_MIN
    isPaused = (await $.store.get('isPaused')) === true
    const storedMuted = await $.store.get('isMuted')
    await update($, isMuted, () => storedMuted === true)

    await schedule($, intervalMin * MINUTE)
    return next(e)
  })

  on('command.run', { command: 'water' }, async $ => {
    await ask($)
    return { text: '💧 Water check is up above the prompt.' }
  })

  on('command.run', { command: 'water-status' }, async $ => {
    const muted = await read($, isMuted)
    let next = 'paused'
    if (!isPaused && nextAt !== undefined) {
      const left = Math.max(1, Math.round((nextAt - (await $.clock.now())) / MINUTE))
      const at = new Date(nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      next = `at ${at} (in ${minutes(left)})`
    } else if (!isPaused) {
      next = 'waiting for your answer'
    }
    return {
      text: [
        `💧 Next reminder: ${next}`,
        `Every ${minutes(intervalMin)} · "Not yet" waits ${minutes(snoozeMin)} · sound ${muted ? 'off 🔇' : 'on 🔊'}`,
      ].join('\n'),
    }
  })

  on('command.run', { command: 'water-pause' }, async $ => {
    isPaused = true
    await $.store.set('isPaused', true)
    await schedule($, 0)
    return { text: '⏸️ Water reminders paused. /water-resume to start again.' }
  })

  on('command.run', { command: 'water-resume' }, async $ => {
    isPaused = false
    await $.store.set('isPaused', false)
    await schedule($, intervalMin * MINUTE)
    return { text: `▶️ Water reminders back on. Next one in ${minutes(intervalMin)}.` }
  })

  on('command.run', { command: 'water-every' }, async ($, e) => {
    const n = parseMinutes(e.args)
    if (n === undefined) {
      return { text: `Usage: /water-every <minutes>, e.g. /water-every 45 (now every ${minutes(intervalMin)})` }
    }
    intervalMin = n
    await $.store.set('intervalMin', n)
    await schedule($, n * MINUTE)
    return { text: `💧 Reminding every ${minutes(n)}${isPaused ? ' (paused — /water-resume to start)' : ''}.` }
  })

  on('command.run', { command: 'water-snooze' }, async ($, e) => {
    const n = parseMinutes(e.args)
    if (n === undefined) {
      return { text: `Usage: /water-snooze <minutes>, e.g. /water-snooze 10 (now ${minutes(snoozeMin)})` }
    }
    snoozeMin = n
    await $.store.set('snoozeMin', n)
    return { text: `⏳ "Not yet" now waits ${minutes(n)}.` }
  })

  on('command.run', { command: 'water-mute' }, async $ => {
    await update($, isMuted, () => true)
    await $.store.set('isMuted', true)
    return { text: '🔇 Water reminder sound off.' }
  })

  on('command.run', { command: 'water-unmute' }, async $ => {
    await update($, isMuted, () => false)
    await $.store.set('isMuted', false)
    return { text: '🔊 Water reminder sound on.' }
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
