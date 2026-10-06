// Run with: claude plugin test .   (tests/*.test.tsx)
// Each test loads the real plugin against an in-memory shared folder, a
// mocked clock and stubbed notifications / network, so nothing on disk,
// no Windows toast and no GitHub call is touched.
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'water-reminder'
const DIR = '/cfg/water-reminder'
const MINUTE = 60 * 1000
// Monday 5 Oct 2026, noon
const NOW = new Date(2026, 9, 5, 12, 0).getTime()

type Shared = Record<string, unknown>

// The world beneath the plugin: files, processes, network, clock, env, store
function world(on: On, files: Record<string, string> = {}, opts: { latest?: string } = {}) {
  const fs = new Map(Object.entries(files))
  const runs: string[][] = []
  // the engine hands paths over absolute (C:/cfg/...): key them without the drive
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

  // these hooks stand for the engine, so they answer { value } or { deny }
  on('fs.read', (_$, e) => {
    const path = norm(e.path)
    if (path.endsWith('/.claude-plugin/plugin.json')) {
      return { value: JSON.stringify({ name: PLUGIN, version: '0.5.0', author: { name: 'Yossi Abutbul' }, license: 'MIT' }) }
    }
    const text = fs.get(path)
    return text === undefined ? { deny: `ENOENT ${path}` } : { value: text }
  })
  on('fs.write', (_$, e) => {
    fs.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', () => ({
    value:
      opts.latest === undefined
        ? { status: 404, ok: false, headers: {}, text: '' }
        : { status: 200, ok: true, headers: {}, text: JSON.stringify({ version: opts.latest }) },
  }))
  // the engine's own band when the plugin has nothing to show: empty
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg' })
  mock.store(on)

  return {
    fs,
    runs,
    clock,
    notifications: () => runs.filter(argv => argv[0] === 'powershell.exe').length,
    shared: (): Shared => JSON.parse(fs.get(`${DIR}/shared.json`) ?? '{}'),
    setShared: (patch: Shared) => fs.set(`${DIR}/shared.json`, JSON.stringify({ ...JSON.parse(fs.get(`${DIR}/shared.json`) ?? '{}'), ...patch })),
    log: (): { t: number; d: boolean; n: number }[] => JSON.parse(fs.get(`${DIR}/log.json`) ?? '[]'),
  }
}

const sharedFile = (s: Shared) => ({ [`${DIR}/shared.json`]: JSON.stringify(s) })
const SETTINGS = { intervalMin: 60, snoozeMin: 5, goal: 8, paused: false, muted: false }

async function startSession($: Engine) {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

// The band above the prompt, as the terminal (or the desktop app) draws it now
async function band($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  })
}

// True while the band shows the question (its "Yes" button)
async function asking($: Engine): Promise<boolean> {
  return (await (await band($)).find({ key: 'yes' })) !== undefined
}

async function run($: Engine, command: string, args = ''): Promise<string> {
  return (await $.command.run({ command, args })).text ?? ''
}

async function pressInBand($: Engine, key: 'yes' | 'snooze' | 'snooze-long') {
  await (await band($)).press({ key })
}

describe('schedule', () => {
  test('the first reminder comes after the interval, with one notification', async ($, on) => {
    const w = world(on)
    await startSession($)
    expect(w.shared().nextAt).toBe(NOW + 60 * MINUTE)

    await w.clock.advance(59 * MINUTE)
    expect(await asking($)).toBe(false)

    await w.clock.advance(MINUTE + 2000)
    expect(await asking($)).toBe(true)
    expect(w.notifications()).toBe(1)
  })

  test('a new session joins the schedule another session set', async ($, on) => {
    const w = world(on, sharedFile({ ...SETTINGS, nextAt: NOW + 10 * MINUTE, scheduledMs: 60 * MINUTE }))
    await startSession($)

    await w.clock.advance(10 * MINUTE + 2000)
    expect(await asking($)).toBe(true)
  })

  test('when another session already sent the notification, the band shows without a second one', async ($, on) => {
    const w = world(on, sharedFile({ ...SETTINGS, nextAt: NOW + MINUTE, scheduledMs: MINUTE }))
    await startSession($)
    // the other session's timer went off first and claimed this round
    w.setShared({ askedAt: NOW + MINUTE, notifiedAt: NOW + MINUTE, nextAt: null })

    await w.clock.advance(MINUTE + 2000)
    expect(await asking($)).toBe(true)
    expect(w.notifications()).toBe(0)
  })

  test('/water-every moves the shared schedule', async ($, on) => {
    const w = world(on)
    await startSession($)
    await run($, 'water-every', '45')

    expect(w.shared().intervalMin).toBe(45)
    expect(w.shared().nextAt).toBe(NOW + 45 * MINUTE)
  })

  test('a pause from another session stops reminders here', async ($, on) => {
    const w = world(on)
    await startSession($)
    w.setShared({ paused: true, nextAt: null })

    await w.clock.advance(61 * MINUTE)
    expect(await asking($)).toBe(false)
    expect(w.notifications()).toBe(0)
  })
})

describe('answers', () => {
  test('"Yes" is logged once and sets the next reminder an interval away', async ($, on) => {
    const w = world(on)
    await startSession($)
    await run($, 'water')
    await pressInBand($, 'yes')

    expect(w.log()).toHaveLength(1)
    expect(w.log()[0]?.d).toBe(true)
    expect(w.shared().nextAt).toBe(NOW + 60 * MINUTE)
    expect(await asking($)).toBe(false)
  })

  test('"In 5 min" is logged and asks again after the snooze', async ($, on) => {
    const w = world(on)
    await startSession($)
    await run($, 'water')
    await pressInBand($, 'snooze')

    expect(w.log()[0]?.d).toBe(false)
    expect(w.shared().nextAt).toBe(NOW + 5 * MINUTE)
  })

  test('"In 10 min" waits twice the snooze', async ($, on) => {
    const w = world(on)
    await startSession($)
    await run($, 'water')
    await pressInBand($, 'snooze-long')

    expect(w.log()[0]?.d).toBe(false)
    expect(w.shared().nextAt).toBe(NOW + 10 * MINUTE)
  })

  test('the snooze buttons follow /water-snooze', async ($, on) => {
    world(on)
    await startSession($)
    await run($, 'water-snooze', '15')
    await run($, 'water')
    const b = await band($)
    expect(await b.find({ text: 'In 15 min' })).toBeDefined()
    expect(await b.find({ text: 'In 30 min' })).toBeDefined()
  })

  test('an answer in another session clears the band here within seconds', async ($, on) => {
    const w = world(on)
    await startSession($)
    await run($, 'water')
    expect(await asking($)).toBe(true)

    w.setShared({ answeredAt: NOW + 1000, nextAt: NOW + 60 * MINUTE })
    await w.clock.advance(6000)
    expect(await asking($)).toBe(false)
  })

  test('answering after another session already answered is not counted twice', async ($, on) => {
    const w = world(on)
    await startSession($)
    await run($, 'water')
    w.setShared({ answeredAt: NOW + 1, nextAt: NOW + 60 * MINUTE })

    await pressInBand($, 'yes')
    expect(w.log()).toHaveLength(0)
    expect(await (await band($)).find({ text: /Already answered/ })).toBeDefined()
  })
})

describe('goal and stats', () => {
  test('/water-goal saves the goal for every session', async ($, on) => {
    const w = world(on)
    await startSession($)

    expect(await run($, 'water-goal', '10')).toContain('Daily goal: 10 glasses')
    expect(w.shared().goal).toBe(10)
  })

  test('/water-goal rejects anything but 1 to 30', async ($, on) => {
    const w = world(on)
    await startSession($)

    for (const bad of ['0', '31', 'abc', '']) {
      expect(await run($, 'water-goal', bad)).toContain('Usage')
    }
    expect(w.shared().goal).toBe(8)
  })

  test('/water-stats counts today against the goal and the streak across days', async ($, on) => {
    const day = (ago: number, hour: number) => new Date(2026, 9, 5 - ago, hour).getTime()
    const log = [
      { t: day(2, 9), d: true, n: 1 },
      { t: day(1, 9), d: true, n: 1 },
      { t: day(1, 10), d: false, n: 1 },
      { t: day(0, 9), d: true, n: 1 },
      { t: day(0, 10), d: true, n: 2 },
    ]
    world(on, { ...sharedFile({ ...SETTINGS, goal: 4 }), [`${DIR}/log.json`]: JSON.stringify(log) })
    await startSession($)

    const text = await run($, 'water-stats', '7')
    expect(text).toContain('**Today** 2/4 glasses')
    expect(text).toContain('**Streak** 🔥 3')
    expect(text).toContain('**Yes rate** 80%')
  })

  test('/water-stats with no history says so', async ($, on) => {
    world(on)
    await startSession($)
    expect(await run($, 'water-stats')).toContain('No water history yet')
  })
})

describe('/water-update', () => {
  test('says up to date when GitHub has no newer version', async ($, on) => {
    const w = world(on, {}, { latest: '0.5.0' })
    await startSession($)

    expect(await run($, 'water-update')).toContain('up to date')
    expect(w.runs.some(argv => argv.includes('update'))).toBe(false)
  })

  test('installs a newer version through claude plugin update', async ($, on) => {
    const w = world(on, {}, { latest: '99.0.0' })
    await startSession($)

    expect(await run($, 'water-update')).toMatch(/v\d+\.\d+\.\d+ → v99\.0\.0/)
    expect(w.runs.some(argv => argv.includes('water-reminder@claude-water-reminder'))).toBe(true)
  })
})

describe('quiet hours', () => {
  const at = (day: number, hour: number, min = 0) => new Date(2026, 9, day, hour, min).getTime()

  test('/water-quiet sets, shows and clears the window for every session', async ($, on) => {
    const w = world(on)
    await startSession($)

    expect(await run($, 'water-quiet', '18:00-09:00')).toContain('Quiet hours: 18:00 to 09:00')
    expect(w.shared().quiet).toEqual({ start: 18 * 60, end: 9 * 60 })
    expect(await run($, 'water-quiet')).toContain('18:00 to 09:00')
    expect(await run($, 'water-status')).toContain('Next reminder')

    expect(await run($, 'water-quiet', 'off')).toContain('Quiet hours off')
    expect(w.shared().quiet).toBe(null)
  })

  test('/water-quiet rejects anything that is not a window', async ($, on) => {
    world(on)
    await startSession($)
    for (const bad of ['18', '25-9', '18:60-9', '9-9', 'evening']) {
      expect(await run($, 'water-quiet', bad)).toContain('Usage')
    }
  })

  test('/water-quiet takes several windows separated by commas', async ($, on) => {
    const w = world(on)
    await startSession($)

    expect(await run($, 'water-quiet', '10:00-12:00, 20:00-22:00')).toContain('Quiet hours: 10:00 to 12:00, 20:00 to 22:00')
    expect(w.shared().quiet).toEqual([
      { start: 10 * 60, end: 12 * 60 },
      { start: 20 * 60, end: 22 * 60 },
    ])
    expect(await run($, 'water-quiet')).toContain('10:00 to 12:00, 20:00 to 22:00')
  })

  test('/water-quiet rejects a bad part, too many windows, or the whole day', async ($, on) => {
    const w = world(on)
    await startSession($)
    for (const bad of ['10-12, evening', '10-12,', '1-2, 3-4, 5-6, 7-8, 9-10, 11-12, 13-14', '0-12, 12-0']) {
      expect(await run($, 'water-quiet', bad)).toContain('Usage')
    }
    expect(w.shared().quiet ?? null).toBe(null)
  })

  test('a reminder walks through windows that touch, to the end of the last', async ($, on) => {
    const w = world(on)
    await startSession($) // next reminder at 13:00
    await run($, 'water-quiet', '12:30-14, 14-15:30, 20-22')

    expect(w.shared().nextAt).toBe(at(5, 15, 30))
  })

  test('an evening window holds a reminder while a morning one is already over', async ($, on) => {
    const w = world(on, sharedFile({ ...SETTINGS, quiet: [{ start: 8 * 60, end: 9 * 60 }, { start: 18 * 60, end: 20 * 60 }] }))
    await startSession($)
    await run($, 'water-every', '420') // 12:00 + 7 h = 19:00, inside the evening window

    expect(w.shared().nextAt).toBe(at(5, 20))
  })

  test('setting quiet hours moves a reminder already inside them to their end', async ($, on) => {
    const w = world(on)
    await startSession($) // next reminder at 13:00
    await run($, 'water-quiet', '12:30-14')

    expect(w.shared().nextAt).toBe(at(5, 14))
  })

  test('an answer whose next reminder lands in quiet hours waits for them to end', async ($, on) => {
    const w = world(on, sharedFile({ ...SETTINGS, quiet: { start: 12 * 60 + 30, end: 14 * 60 } }))
    await startSession($)
    await run($, 'water')
    await pressInBand($, 'yes')

    expect(w.shared().nextAt).toBe(at(5, 14))
  })

  test('a window across midnight pushes an evening reminder to the next morning', async ($, on) => {
    const w = world(on, sharedFile({ ...SETTINGS, quiet: { start: 18 * 60, end: 9 * 60 } }))
    await startSession($)
    await run($, 'water-every', '420') // 12:00 + 7 h = 19:00, inside the window

    expect(w.shared().nextAt).toBe(at(6, 9))
  })

  test('quiet hours set in another session hold a reminder that comes due inside them', async ($, on) => {
    const w = world(on)
    await startSession($) // next reminder at 13:00
    w.setShared({ quiet: { start: 12 * 60 + 30, end: 14 * 60 } })

    await w.clock.advance(61 * MINUTE + 2000)
    expect(await asking($)).toBe(false)
    expect(w.notifications()).toBe(0)
    expect(w.shared().nextAt).toBe(at(5, 14))

    await w.clock.advance(60 * MINUTE)
    expect(await asking($)).toBe(true)
    expect(w.notifications()).toBe(1)
  })
})

describe('/water-drank', () => {
  test('logs a glass and restarts the countdown', async ($, on) => {
    const w = world(on)
    await startSession($)
    await w.clock.advance(20 * MINUTE)

    expect(await run($, 'water-drank')).toContain('Glass logged: 1 of 8 today')
    expect(w.log()).toHaveLength(1)
    expect(w.log()[0]?.d).toBe(true)
    expect(w.shared().nextAt).toBe(NOW + 80 * MINUTE)
  })

  test('answers the question when one is up', async ($, on) => {
    const w = world(on)
    await startSession($)
    await run($, 'water')
    await run($, 'water-drank')

    expect(await asking($)).toBe(false)
    expect(w.log()).toHaveLength(1)
  })
})

describe('critter mood', () => {
  // what the desktop band's critter shows, by its alt text
  const critter = async ($: Engine) => {
    const svg = await (await band($, 'desktop')).find({ type: 'Svg' })
    return (svg?.props as { alt?: string } | undefined)?.alt ?? ''
  }

  test('the critter dances after "Yes" and looks sad after a snooze', async ($, on) => {
    const w = world(on)
    await startSession($)
    await run($, 'water')
    expect(await critter($)).toBe('Claude critter holding a water bottle')
    await pressInBand($, 'yes')
    expect(await critter($)).toMatch(/dancing/)

    await w.clock.advance(60 * MINUTE + 2000)
    expect(await critter($)).toBe('Claude critter holding a water bottle')
    await pressInBand($, 'snooze')
    expect(await critter($)).toMatch(/sad/)
  })

  test('the glass that reaches the daily goal gets a confetti party', async ($, on) => {
    world(on)
    await startSession($)
    await run($, 'water-goal', '2')
    expect(await run($, 'water-drank')).toContain('1 of 2')
    expect(await critter($)).toBe('')

    expect(await run($, 'water-drank')).toContain('Daily goal reached')
    expect(await critter($)).toMatch(/confetti/)
  })
})

describe('/water-help', () => {
  const help = ($: Engine, surface: 'terminal' | 'desktop', text: string) =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'CommandOutput', props: { command: 'water-help', args: '', text, isErrored: false } })

  test('draws a button per command on desktop and a table in the terminal', async ($, on) => {
    world(on)
    await startSession($)
    const text = await run($, 'water-help')
    expect(text).toContain('| `/water-drank` |')

    const desktop = await help($, 'desktop', text)
    for (const label of ['/water-drank', '/water-every', '/water-quiet', '/water-version']) {
      expect(await desktop.find({ text: label })).toBeDefined()
    }
    expect(await desktop.find({ text: /^Now: / })).toBeDefined()

    const terminal = await help($, 'terminal', text)
    expect(await terminal.find({ type: 'Button' })).toBeUndefined()
    expect(await terminal.find({ type: 'Markdown' })).toBeDefined()
  })
})

describe('reply rows', () => {
  const row = ($: Engine, surface: 'terminal' | 'desktop', command: string, text: string) =>
    $.ui.mount({ plugin: PLUGIN, surface, component: 'CommandOutput', props: { command, args: '', text, isErrored: false } })

  test('replies draw their own SVG icon on desktop and text in the terminal', async ($, on) => {
    world(on)
    await startSession($)
    const text = await run($, 'water-pause')

    const desktop = await row($, 'desktop', 'water-pause', text)
    expect(await desktop.find({ type: 'Svg' })).toBeDefined()
    expect(await desktop.find({ text: 'Reminders paused' })).toBeDefined()

    const terminal = await row($, 'terminal', 'water-pause', text)
    expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
    expect(await terminal.find({ text: 'Reminders paused' })).toBeDefined()
  })
})
