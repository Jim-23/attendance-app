export interface CalendarDay {
  date: string
  inMonth: boolean
  weekend: boolean
}

export function getMonthDays(month: string): CalendarDay[] {
  const [year, monthNumber] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const last = new Date(Date.UTC(year, monthNumber, 0))
  const offset = (first.getUTCDay() + 6) % 7
  const cellCount = Math.ceil((offset + last.getUTCDate()) / 7) * 7

  return Array.from({ length: cellCount }, (_, index) => {
    const day = new Date(Date.UTC(year, monthNumber - 1, index - offset + 1))
    return {
      date: day.toISOString().slice(0, 10),
      inMonth: day.getUTCMonth() === monthNumber - 1,
      weekend: day.getUTCDay() === 0 || day.getUTCDay() === 6,
    }
  })
}

export function shiftMonth(month: string, change: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber - 1 + change, 1))
    .toISOString().slice(0, 7)
}

export function getCzechHolidays(year: number): Map<string, string> {
  const fixedHolidays: [string, string][] = [
    ['01-01', 'Nový rok / Den obnovy samostatného českého státu'],
    ['05-01', 'Svátek práce'],
    ['05-08', 'Den vítězství'],
    ['07-05', 'Den slovanských věrozvěstů Cyrila a Metoděje'],
    ['07-06', 'Den upálení mistra Jana Husa'],
    ['09-28', 'Den české státnosti'],
    ['10-28', 'Den vzniku samostatného československého státu'],
    ['11-17', 'Den boje za svobodu a demokracii a Mezinárodní den studentstva'],
    ['12-24', 'Štědrý den'],
    ['12-25', '1. svátek vánoční'],
    ['12-26', '2. svátek vánoční'],
  ]
  const holidays = new Map(
    fixedHolidays.map(([date, label]) => [`${year}-${date}`, label]),
  )

  // Gregorian Easter (Meeus/Jones/Butcher).
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = (h + l - 7 * m + 114) % 31 + 1

  for (const [offset, label] of [
    [-2, 'Velký pátek'],
    [1, 'Velikonoční pondělí'],
  ] as const) {
    const date = new Date(Date.UTC(year, month - 1, day + offset))
    holidays.set(date.toISOString().slice(0, 10), label)
  }

  return holidays
}
