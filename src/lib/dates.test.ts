import { describe, expect, it } from 'vitest'
import { daysBetween, nextBirthday, relativeDays, todayYMD } from './dates'

describe('daysBetween', () => {
  it('counts calendar days across DST changes and year ends', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2026-01-10', '2026-01-03')).toBe(-7)
  })
})

describe('nextBirthday', () => {
  it('finds this year’s birthday and the age being turned', () => {
    expect(nextBirthday('1990-10-20', '2026-10-14')).toEqual({ date: '2026-10-20', daysAway: 6, turning: 36 })
  })

  it('is today on the day itself', () => {
    expect(nextBirthday('1990-10-14', '2026-10-14').daysAway).toBe(0)
  })

  it('rolls over to next year once it has passed', () => {
    expect(nextBirthday('1990-01-05', '2026-10-14')).toEqual({ date: '2027-01-05', daysAway: 83, turning: 37 })
  })

  it('has no age when the year is unknown', () => {
    expect(nextBirthday('1604-10-15', '2026-10-14').turning).toBeNull()
  })

  it('puts Feb 29 birthdays on Feb 28 outside leap years', () => {
    expect(nextBirthday('2000-02-29', '2027-01-01').date).toBe('2027-02-28')
    expect(nextBirthday('2000-02-29', '2028-01-01').date).toBe('2028-02-29')
  })
})

describe('relativeDays', () => {
  it('reads naturally', () => {
    expect([0, 1, -1, 5, -3].map(relativeDays)).toEqual(['Today', 'Tomorrow', 'Yesterday', 'in 5 days', '3 days ago'])
  })
})

describe('todayYMD', () => {
  it('uses the local calendar date', () => {
    expect(todayYMD(new Date(2026, 0, 2, 23, 30))).toBe('2026-01-02')
  })
})
