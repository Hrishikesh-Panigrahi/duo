// Date-only values ("YYYY-MM-DD") are calendar days, not instants: handled as local dates, so no timezone shifts.

/** Birthdays stored with this year have no known year (iOS uses the same trick). */
export const NO_YEAR = 1604

export const MS_PER_DAY = 86_400_000

export type YMD = { y: number; m: number; d: number }

export function parseYMD(s: string): YMD {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return { y, m, d }
}

export function toYMDString({ y, m, d }: YMD): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function toLocalYMD(now = new Date()): string {
  return toYMDString({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() })
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). DST-proof. */
export function daysBetween(from: string, to: string): number {
  const start = parseYMD(from)
  const end = parseYMD(to)
  const startMs = Date.UTC(start.y, start.m - 1, start.d)
  const endMs = Date.UTC(end.y, end.m - 1, end.d)
  return Math.round((endMs - startMs) / MS_PER_DAY)
}

type Birthday = { date: string; daysAway: number; turning: number | null }

/** The birthday as it falls in `year`, counted from `today`. Feb 29 falls on Feb 28 in other years. */
function birthdayIn(year: number, born: YMD, today: string): Birthday {
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const date = toYMDString({ y: year, m: born.m, d: born.m === 2 && born.d === 29 && !isLeapYear ? 28 : born.d })
  return { date, daysAway: daysBetween(today, date), turning: born.y === NO_YEAR ? null : year - born.y }
}

/** Next occurrence of a birthday on or after `today`: this year's, else next year's. */
export function nextBirthday(birthday: string, today: string): Birthday {
  const born = parseYMD(birthday)
  const thisYear = parseYMD(today).y
  const thisTime = birthdayIn(thisYear, born, today)
  return thisTime.daysAway >= 0 ? thisTime : birthdayIn(thisYear + 1, born, today)
}

const dayMonthFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const dayMonthYearFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function formatDay(s: string, withYear = true): string {
  const { y, m, d } = parseYMD(s)
  // A day with no year is formatted in 2000, a leap year, so 29 Feb still formats.
  const date = new Date(y === NO_YEAR ? 2000 : y, m - 1, d)
  return (withYear && y !== NO_YEAR ? dayMonthYearFormat : dayMonthFormat).format(date)
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "just now", "5 minutes ago", "yesterday", then a plain date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const secondsAgo = (now - new Date(iso).getTime()) / 1000
  if (secondsAgo < 60) return 'just now'
  if (secondsAgo < 3600) return relativeTime.format(-Math.floor(secondsAgo / 60), 'minute')
  if (secondsAgo < 86_400) return relativeTime.format(-Math.floor(secondsAgo / 3600), 'hour')
  const daysAgo = daysBetween(toLocalYMD(new Date(iso)), toLocalYMD(new Date(now)))
  if (daysAgo < 7) return relativeTime.format(-daysAgo, 'day')
  return formatDay(toLocalYMD(new Date(iso)))
}

export function relativeDays(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}
