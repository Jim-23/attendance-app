import assert from 'node:assert/strict'
import test from 'node:test'
import { getCzechHolidays, getMonthDays, shiftMonth } from './calendar.ts'

test('month grid starts on Monday and includes each day exactly once', () => {
  const days = getMonthDays('2026-10')
  assert.equal(days[0].date, '2026-09-28')
  assert.equal(days.at(-1).date, '2026-11-01')
  assert.equal(days.length, 35)
  assert.equal(days.filter((day) => day.inMonth).length, 31)
  assert.equal(new Set(days.map((day) => day.date)).size, days.length)
  assert.equal(days[5].weekend, true)
  assert.equal(days[6].weekend, true)
  assert.equal(days[7].weekend, false)
})

test('month grids include leap day and six-week months', () => {
  assert.equal(getMonthDays('2024-02').filter((day) => day.inMonth).length, 29)
  assert.equal(getMonthDays('2026-03').length, 42)
})

test('month navigation crosses year boundaries', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
})

test('Czech holidays contain all 13 dates including movable Easter holidays', () => {
  const holidays = getCzechHolidays(2026)
  assert.equal(holidays.size, 13)
  assert.equal(holidays.get('2026-04-03'), 'Velký pátek')
  assert.equal(holidays.get('2026-04-06'), 'Velikonoční pondělí')
  assert.equal(holidays.get('2026-10-28'), 'Den vzniku samostatného československého státu')
  assert.equal(holidays.get('2026-12-26'), '2. svátek vánoční')
  assert.equal(holidays.has('2026-12-28'), false)
  assert.equal(getCzechHolidays(2024).get('2024-03-29'), 'Velký pátek')
  assert.equal(getCzechHolidays(2024).get('2024-04-01'), 'Velikonoční pondělí')
  assert.equal(getCzechHolidays(2027).get('2027-03-26'), 'Velký pátek')
  assert.equal(getCzechHolidays(2027).get('2027-03-29'), 'Velikonoční pondělí')
})
