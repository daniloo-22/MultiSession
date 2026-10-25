// Muted, warm-leaning hues so account dots sit quietly next to the accent.
export const ACCOUNT_COLORS = [
  '#b9694e',
  '#c49a4a',
  '#8a9a5b',
  '#5e8c7a',
  '#5f7f9e',
  '#7d6b9e',
  '#a8687f',
  '#857a6c'
] as const

export const pickColor = (used: string[]): string =>
  ACCOUNT_COLORS.find((c) => !used.includes(c)) ??
  ACCOUNT_COLORS[used.length % ACCOUNT_COLORS.length]
