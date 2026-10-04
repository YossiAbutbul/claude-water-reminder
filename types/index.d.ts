export type Nag = number

declare module 'claude-code' {
  interface PluginState {
    'water-reminder': {
      isAsking: boolean
      isMuted: boolean
      nag: Nag
      reply: string | null
    }
  }
}
