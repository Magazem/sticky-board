export type Note = {
  id: string
  lane: string
  title: string
  detail: string | null
  area: string | null
  priority: number
  status: string
  created_at: string
  updated_at: string
}

export type Board = {
  projectName: string
  notes: Note[]
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'sticky-board': { board: Board; focus: string }
  }
}
