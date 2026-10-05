export type Nag = number

export type Rank = { emoji: string; name: string; blurb: string }

export type DayRow = { label: string; drinks: number; skips: number; isToday: boolean }

// One /water-stats run, kept so its transcript row can be drawn as a card
export type Report = {
  days: number
  range: string
  rows: DayRow[]
  hours: number[]
  today: DayRow
  lastSip: string | null
  windowDrinks: number
  windowSkips: number
  litres: number
  perDay: number
  trend: 'up' | 'down' | 'flat' | null
  drinks: number
  skips: number
  yesRate: number | null
  firstTryRate: number | null
  streak: number
  best: number
  thirstiest: string | null
  bestDay: string | null
  snoozeHour: string | null
  snoozesPerSip: string | null
  rank: Rank
}

// How a water command's output row is drawn
export type Settings = { intervalMin: number; snoozeMin: number; paused: boolean; muted: boolean }
export type Note =
  | { kind: 'line'; icon: string; title: string; hint?: string; tone: 'blue' | 'orange' | 'dim' }
  | { kind: 'status'; state: 'scheduled' | 'asking' | 'paused'; at?: string; leftMin?: number; progress?: number; settings: Settings }
  | { kind: 'about'; version: string; author: string; repo: string; copyright: string }

declare module 'claude-code' {
  interface PluginState {
    'water-reminder': {
      isAsking: boolean
      isMuted: boolean
      nag: Nag
      reply: string | null
      reports: Record<string, Report>
      notes: Record<string, Note>
    }
  }
}
