// Date-only values ("YYYY-MM-DD") are calendar days, not instants, so they're
// handled as local dates throughout to avoid off-by-one-day timezone bugs.

/** Birthdays stored with this year have no known year (iOS uses the same trick). */
export const NO_YEAR = 1604

export type YMD = { y: number; m: number; d: number }

export function parseYMD(s: string): YMD {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return { y, m, d }
}

export function toYMDString({ y, m, d }: YMD): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function todayYMD(now = new Date()): string {
  return toYMDString({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() })
}

/** Whole calendar days from a to b (negative if b is earlier). DST-proof. */
export function daysBetween(a: string, b: string): number {
  const x = parseYMD(a)
  const y = parseYMD(b)
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86_400_000)
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** Next occurrence of a birthday on or after `today`. Feb 29 falls on Feb 28 in other years. */
export function nextBirthday(birthday: string, today: string): { date: string; daysAway: number; turning: number | null } {
  const b = parseYMD(birthday)
  const t = parseYMD(today)
  const on = (year: number) => toYMDString({ y: year, m: b.m, d: b.m === 2 && b.d === 29 && !isLeap(year) ? 28 : b.d })
  let date = on(t.y)
  if (daysBetween(today, date) < 0) date = on(t.y + 1)
  const year = parseYMD(date).y
  return { date, daysAway: daysBetween(today, date), turning: b.y === NO_YEAR ? null : year - b.y }
}

const monthFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const fullFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function formatDay(s: string, withYear = true): string {
  const { y, m, d } = parseYMD(s)
  const date = new Date(y === NO_YEAR ? 2000 : y, m - 1, d)
  return (withYear && y !== NO_YEAR ? fullFmt : monthFmt).format(date)
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "just now", "5 minutes ago", "yesterday", then a plain date. */
export function ago(iso: string, now = Date.now()): string {
  const s = (now - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute')
  if (s < 86_400) return rtf.format(-Math.floor(s / 3600), 'hour')
  const days = -daysBetween(todayYMD(new Date(now)), todayYMD(new Date(iso)))
  if (days < 7) return rtf.format(-days, 'day')
  return formatDay(todayYMD(new Date(iso)))
}

export function relativeDays(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}
