import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const modules = new Map()
function loadModule(path) {
  if (modules.has(path)) return modules.get(path)
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    (name) => name.startsWith('.') ? loadModule(resolve(dirname(path), `${name}.ts`)) : require(name),
    mod, mod.exports,
  )
  modules.set(path, mod.exports)
  return mod.exports
}

const { getVacationUsedMinutes, leaveLabels, formatLeaveDays } = loadModule(resolve('src/lib/leave.ts'))
test('leave allowance uses Czech day counts with eight-hour days', () => {
  assert.equal(formatLeaveDays(0), '0 dní')
  assert.equal(formatLeaveDays(480), '1 den')
  assert.equal(formatLeaveDays(960), '2 dny')
  assert.equal(formatLeaveDays(1440), '3 dny')
  assert.equal(formatLeaveDays(240), '0,5 dní')
  assert.equal(formatLeaveDays(2400), '5 dní')
})
const { getUserStatistics, getInvitationStatus, isAdminUser } = loadModule(resolve('src/lib/admin.ts'))
const { calculateDailyBalances, getDailyLunchDeductions, hasLunchOnDate } = loadModule(resolve('src/lib/attendance.ts'))
const { calculateShiftEnd, calculateMinutesUntil, calculateWorkedMinutes } = loadModule(resolve('src/lib/attendance.ts'))
const { getMonthlyStatistics } = loadModule(resolve('src/lib/monthly.ts'))
const { getAttendanceExportRows, EXPORT_HEADERS } = loadModule(resolve('src/lib/export.ts'))
const { createAttendanceExcel, EXPORT_COLOURS } = loadModule(resolve('src/lib/excelExport.ts'))
const ExcelJS = require('exceljs')

test('Excel daily summaries include all dates and Czech columns, net work, lunch and daily balance', () => {
  const now = new Date('2026-11-01T12:00:00Z')
  const sessions = [{
    started_at: '2026-10-01T04:00:00Z',
    ended_at: '2026-10-01T12:30:00Z',
    lunch_started_at: '2026-10-01T10:00:00Z',
  }]
  const rows = getAttendanceExportRows(sessions, [], '2026-10', now)
  assert.equal(rows.length, 31)
  assert.deepEqual(rows[0].slice(0, 8), ['Čt', '01.10.2026', '8:00', '8:00', '0:30', '0:00', '06:00', '14:30'])
  assert.deepEqual(rows[2].slice(0, 8), ['So', '03.10.2026', '0:00', '0:00', '0:00', '0:00', '', ''])
  assert.equal(rows[1][5], '-8:00')
  assert.equal(rows[27][3], '8:00')
  assert.match(rows[27][8], /Den vzniku/)
  assert.equal(EXPORT_HEADERS.length, 10)
  assert.equal(EXPORT_HEADERS[9], 'Stav')
})

test('Excel year includes every date including leap day and matches monthly totals', () => {
  const now = new Date('2027-01-01T12:00:00Z')
  const sessions = [
    { started_at: '2026-10-01T06:07:00Z', ended_at: '2026-10-01T14:45:00Z', lunch_started_at: null },
    { started_at: '2026-10-03T06:00:00Z', ended_at: '2026-10-03T08:00:00Z', lunch_started_at: null },
  ]
  const leave = [
    { date: '2026-10-02', type: 'vacation', duration_minutes: 240 },
    { date: '2026-10-05', type: 'sick_day', duration_minutes: 480 },
    { date: '2026-10-28', type: 'holiday', duration_minutes: 480 },
    { date: '2026-10-28', type: 'vacation', duration_minutes: 480 },
  ]
  const year = getAttendanceExportRows(sessions, leave, '2026', now)
  assert.equal(year.length, 365)
  assert.equal(year[0][1], '01.01.2026')
  assert.equal(year.at(-1)[1], '31.12.2026')
  assert.equal(new Set(year.map(row => row[1])).size, 365)
  const leap = getAttendanceExportRows([], [], '2024', now)
  assert.equal(leap.length, 366)
  assert.equal(leap[59][1], '29.02.2024')
  const month = getAttendanceExportRows(sessions, leave, '2026-10', now)
  assert.deepEqual(year.filter(row => row[1].endsWith('.10.2026')), month)
  const minutes = value => {
    const [h, m] = value.split(':').map(Number)
    return h * 60 + m
  }
  const statistics = getMonthlyStatistics(sessions, leave, '2026-10', now)
  assert.equal(month.reduce((sum, row) => sum + minutes(row[2]), 0), statistics.fundMinutes)
  assert.equal(month.reduce((sum, row) => sum + minutes(row[3]), 0), statistics.fulfilledMinutes)
})

test('Excel aggregates split and overnight sessions with one lunch, notes unclosed and future records', () => {
  const now = new Date('2026-10-07T07:00:00Z')
  const sessions = [
    { started_at: '2026-10-01T04:00:00Z', ended_at: '2026-10-01T06:00:00Z', lunch_started_at: '2026-10-01T05:00:00Z' },
    { started_at: '2026-10-01T07:00:00Z', ended_at: '2026-10-01T13:00:00Z', lunch_started_at: null },
    { started_at: '2026-10-05T21:00:00Z', ended_at: '2026-10-06T01:00:00Z', lunch_started_at: null },
    { started_at: '2026-10-07T04:00:00Z', ended_at: null, lunch_started_at: null, planned_departure_at: '2026-10-07T12:30:00Z' },
  ]
  const leave = [{ date: '2026-10-20', type: 'vacation', duration_minutes: 480 }]
  const rows = getAttendanceExportRows(sessions, leave, '2026-10', now)
  assert.equal(rows[0][3], '7:30')
  assert.equal(rows[0][4], '0:30')
  assert.equal(rows[0][7], '15:00')
  assert.match(rows[0][8], /Pracovní záznamy: 2/)
  assert.equal(rows[4][7], '06.10.2026 03:00')
  assert.equal(rows[6][3], '0:00')
  assert.equal(rows[6][6], '')
  assert.match(rows[6][8], /Neukončená docházka od 06:00/)
  assert.match(rows[6][8], /Plánovaný odchod 14:30/)
  assert.equal(rows[19][3], '0:00')
  assert.equal(rows[19][5], '')
  assert.match(rows[19][8], /dosud nezapočteno/)
  assert.equal(rows[27][3], '0:00')
  assert.equal(rows[27][5], '')
})

test('Excel preserves Czech notes, semicolons, quotes and line breaks and rejects invalid periods', async () => {
  const bytes = await createAttendanceExcel([], [{
    date: '2026-10-01', type: 'vacation', duration_minutes: 240,
    note: 'Lékař; "kontrola"\r\nDruhý řádek',
  }], '2026-10', new Date('2026-11-01T12:00:00Z'))
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  assert.equal(workbook.getWorksheet('říjen 2026').getCell('I2').value,
    'Dovolená 4:00: Lékař; "kontrola"\nDruhý řádek')
  assert.throws(() => getAttendanceExportRows([], [], '2026-13', new Date()), /Neplatný/)
  assert.throws(() => getAttendanceExportRows([], [], '', new Date()), /Neplatný/)
})

test('Excel workbook persists highlighting, Czech statuses, filters, frozen headers and a legend', async () => {
  const sessions = [
    { started_at: '2026-10-01T06:00:00Z', ended_at: '2026-10-01T15:00:00Z', lunch_started_at: null },
    { started_at: '2026-10-06T06:00:00Z', ended_at: null, lunch_started_at: null },
    { started_at: '2026-10-07T06:00:00Z', ended_at: null, lunch_started_at: null },
  ]
  const leave = [
    { date: '2026-10-05', type: 'vacation', duration_minutes: 240, note: '=SUM(A1:A5)' },
    { date: '2026-10-08', type: 'sick_day', duration_minutes: 480 },
  ]
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await createAttendanceExcel(sessions, leave, '2026-10', new Date('2026-10-07T07:00:00Z')))
  const sheet = workbook.getWorksheet('říjen 2026')
  const colour = address => sheet.getCell(address).fill.fgColor.argb
  assert.equal(sheet.rowCount, 32)
  assert.equal(workbook.worksheets.length, 2)
  assert.ok(workbook.getWorksheet('Legenda'))
  assert.equal(sheet.views[0].state, 'frozen')
  assert.equal(sheet.views[0].ySplit, 1)
  assert.ok(sheet.autoFilter)
  assert.equal(colour('F2'), `FF${EXPORT_COLOURS.extra}`)
  assert.match(sheet.getCell('J2').value, /Nad denní plán/)
  assert.equal(colour('F3'), `FF${EXPORT_COLOURS.missing}`)
  assert.match(sheet.getCell('J3').value, /Chybí hodiny/)
  assert.equal(colour('A4'), `FF${EXPORT_COLOURS.weekend}`)
  assert.equal(colour('A6'), `FF${EXPORT_COLOURS.leave}`)
  assert.equal(colour('F6'), `FF${EXPORT_COLOURS.missing}`)
  assert.match(sheet.getCell('J6').value, /Dovolená.*Chybí hodiny/)
  assert.equal(sheet.getCell('I6').type, ExcelJS.ValueType.String)
  assert.match(sheet.getCell('I6').value, /=SUM\(A1:A5\)/)
  assert.equal(colour('J7'), `FF${EXPORT_COLOURS.pending}`)
  assert.match(sheet.getCell('J7').value, /Neukončená docházka.*Chybí hodiny/)
  assert.equal(colour('J8'), `FF${EXPORT_COLOURS.pending}`)
  assert.doesNotMatch(sheet.getCell('J8').value, /Chybí hodiny/)
  assert.equal(sheet.getCell('F9').value, '')
  assert.equal(sheet.getCell('A9').font.color.argb, 'FF64748B')
  assert.match(sheet.getCell('J9').value, /Sick day.*Budoucí den/)
  assert.equal(colour('A29'), `FF${EXPORT_COLOURS.holiday}`)
  assert.match(sheet.getCell('J29').value, /Svátek.*Budoucí den/)
})

test('annual Excel has twelve Czech monthly sheets and all 366 leap-year dates', async () => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await createAttendanceExcel([], [], '2024', new Date('2025-01-01T12:00:00Z')))
  assert.equal(workbook.worksheets.length, 13)
  assert.equal(workbook.getWorksheet('únor 2024').rowCount, 30)
  assert.equal(workbook.getWorksheet('únor 2024').getCell('B30').value, '29.02.2024')
  assert.equal(workbook.worksheets.filter(sheet => sheet.name !== 'Legenda')
    .reduce((sum, sheet) => sum + sheet.rowCount - 1, 0), 366)
})

test('monthly Fond includes weekday holidays and credits them as paid hours', () => {
  const now = new Date('2026-10-07T07:00:00Z')
  const stats = getMonthlyStatistics([], [], '2026-10', now)
  assert.equal(stats.workingDays, 22)
  assert.equal(stats.holidayDays, 1)
  assert.equal(stats.fundMinutes, 176 * 60)
  assert.equal(stats.remainingMinutes, 176 * 60)
  assert.equal(stats.creditedHolidayMinutes, 0)
  assert.equal(stats.plannedHolidayMinutes, 8 * 60)
  assert.equal(stats.projectedRemainingMinutes, 168 * 60)
  const april = getMonthlyStatistics([], [], '2026-04', now)
  assert.equal(april.fundMinutes, 176 * 60)
  assert.equal(april.creditedHolidayMinutes, 16 * 60)
  assert.equal(april.remainingMinutes, 160 * 60)
  // July 5 and December 26 are on weekends in 2026.
  const july = getMonthlyStatistics([], [], '2026-07', now)
  assert.equal(july.fundMinutes, 184 * 60)
  assert.equal(july.creditedHolidayMinutes, 8 * 60)
  const december = getMonthlyStatistics([], [], '2026-12', now)
  assert.equal(december.fundMinutes, 184 * 60)
  assert.equal(december.plannedHolidayMinutes, 16 * 60)
  assert.equal(getMonthlyStatistics([], [], '2024-02', now).fundMinutes, 168 * 60)
  const halfTime = getMonthlyStatistics([], [], '2026-10', now, 240)
  assert.equal(halfTime.fundMinutes, 88 * 60)
  assert.equal(halfTime.plannedHolidayMinutes, 240)
})

test('leave fulfils monthly Fond without lunch, while future leave remains planned', () => {
  const now = new Date('2026-10-07T07:00:00Z')
  const days = [
    { date: '2026-10-01', type: 'vacation', duration_minutes: 240 },
    { date: '2026-10-02', type: 'sick_day', duration_minutes: 480 },
    { date: '2026-10-05', type: 'mandatory_vacation', duration_minutes: 480 },
    { date: '2026-10-06', type: 'comp_time', duration_minutes: 120 },
    { date: '2026-10-20', type: 'vacation', duration_minutes: 480 },
    { date: '2026-10-28', type: 'vacation', duration_minutes: 480 },
    { date: '2026-10-03', type: 'sick_day', duration_minutes: 480 },
    { date: '2026-11-02', type: 'vacation', duration_minutes: 480 },
  ]
  const stats = getMonthlyStatistics([], days, '2026-10', now)
  assert.equal(stats.fundMinutes, 10560)
  assert.equal(stats.creditedLeaveMinutes, 1320)
  assert.equal(stats.fulfilledMinutes, 1320)
  assert.equal(stats.plannedLeaveMinutes, 480)
  assert.equal(stats.plannedHolidayMinutes, 480)
  assert.equal(stats.projectedMinutes, 2280)
  assert.equal(stats.remainingMinutes, 9240)
  assert.equal(stats.projectedRemainingMinutes, 8280)
  const afterDate = getMonthlyStatistics([], days, '2026-10', new Date('2026-10-20T06:00:00Z'))
  assert.equal(afterDate.creditedLeaveMinutes, 1800)
  assert.equal(afterDate.plannedLeaveMinutes, 0)
  assert.equal(afterDate.plannedHolidayMinutes, 480)
  const duplicate = getMonthlyStatistics([], [...days, days[1]], '2026-10', now)
  assert.equal(duplicate.creditedLeaveMinutes, stats.creditedLeaveMinutes)
})

test('adding and removing a holiday or leave recalculates fulfilment without double credits or changing Fond', () => {
  const now = new Date('2026-10-31T12:00:00Z')
  const vacation = { date: '2026-10-06', type: 'vacation', duration_minutes: 480 }
  const extraHoliday = { date: '2026-10-06', type: 'holiday', duration_minutes: 480 }
  const nationalHoliday = { date: '2026-10-28', type: 'holiday', duration_minutes: 480 }
  const withVacation = getMonthlyStatistics([], [vacation], '2026-10', now)
  assert.equal(withVacation.fundMinutes, 10560)
  assert.equal(withVacation.fulfilledMinutes, 960)
  const withHoliday = getMonthlyStatistics([], [vacation, extraHoliday, extraHoliday, nationalHoliday], '2026-10', now)
  assert.equal(withHoliday.fundMinutes, 10560)
  assert.equal(withHoliday.fulfilledMinutes, 960)
  assert.equal(withHoliday.creditedLeaveMinutes, 0)
  assert.equal(withHoliday.creditedHolidayMinutes, 960)
  assert.equal(withHoliday.holidayDays, 2)
  assert.equal(getMonthlyStatistics([], [], '2026-10', now).fulfilledMinutes, 480)
})

test('monthly work and projections use rounding and one daily lunch, and plans never count as completed', () => {
  const now = new Date('2026-10-07T07:00:00Z')
  const completed = {
    started_at: '2026-10-06T06:07:00Z', ended_at: '2026-10-06T14:45:00Z',
    lunch_started_at: null,
  }
  const open = {
    started_at: '2026-10-07T06:00:00Z', ended_at: null,
    planned_departure_at: '2026-10-07T15:30:00Z', lunch_started_at: null,
  }
  const stats = getMonthlyStatistics([completed, open], [], '2026-10', now)
  assert.equal(stats.workedMinutes, 480)
  assert.equal(stats.plannedWorkMinutes, 540)
  assert.equal(stats.fulfilledMinutes, 480)
  assert.equal(stats.projectedMinutes, 1500)
  const finished = getMonthlyStatistics(
    [completed, { ...open, ended_at: open.planned_departure_at, planned_departure_at: null }],
    [], '2026-10', new Date('2026-10-07T16:00:00Z'),
  )
  assert.equal(finished.workedMinutes, 1020)
  assert.equal(finished.plannedWorkMinutes, 0)
  assert.equal(getMonthlyStatistics([completed, { ...open, planned_departure_at: null }], [], '2026-10', now).projectedMinutes, 960)

  const morning = { started_at: '2026-10-07T05:00:00Z', ended_at: '2026-10-07T07:00:00Z', lunch_started_at: '2026-10-07T06:00:00Z' }
  const afternoon = { ...open, started_at: '2026-10-07T08:00:00Z', planned_departure_at: '2026-10-07T14:00:00Z' }
  const split = getMonthlyStatistics([morning, afternoon], [], '2026-10', now)
  assert.equal(split.workedMinutes, 90)
  assert.equal(split.plannedWorkMinutes, 360)
  assert.equal(split.projectedMinutes, 930)
})

test('paid holidays move from planned to fulfilled on the Prague holiday date', () => {
  const before = getMonthlyStatistics([], [], '2026-10', new Date('2026-10-27T22:59:59Z'))
  const holiday = getMonthlyStatistics([], [
    { date: '2026-10-28', type: 'vacation', duration_minutes: 240 },
    { date: '2026-10-28', type: 'holiday', duration_minutes: 480 },
  ], '2026-10', new Date('2026-10-27T23:00:00Z'))
  assert.equal(before.plannedHolidayMinutes, 480)
  assert.equal(before.fulfilledMinutes, 0)
  assert.equal(holiday.plannedHolidayMinutes, 0)
  assert.equal(holiday.creditedHolidayMinutes, 480)
  assert.equal(holiday.creditedLeaveMinutes, 0)
  assert.equal(holiday.fulfilledMinutes, 480)
  assert.equal(holiday.projectedMinutes, before.projectedMinutes)
  assert.equal(holiday.fundMinutes, before.fundMinutes)
})

test('monthly assignment follows Prague arrival date and completed work can exceed Fond', () => {
  const now = new Date('2026-11-02T12:00:00Z')
  const atBoundary = { started_at: '2026-09-30T22:30:00Z', ended_at: '2026-10-01T00:30:00Z', lunch_started_at: null }
  assert.equal(getMonthlyStatistics([atBoundary], [], '2026-09', now).workedMinutes, 0)
  assert.equal(getMonthlyStatistics([atBoundary], [], '2026-10', now).workedMinutes, 120)
  const weekendWork = { started_at: '2026-10-03T06:00:00Z', ended_at: '2026-10-03T08:00:00Z', lunch_started_at: null }
  assert.equal(getMonthlyStatistics([weekendWork], [], '2026-10', now).workedMinutes, 120)
  const many = Array.from({ length: 22 }, (_, index) => ({
    started_at: `2026-10-${String(index + 1).padStart(2, '0')}T06:00:00Z`,
    ended_at: `2026-10-${String(index + 1).padStart(2, '0')}T14:30:00Z`,
    lunch_started_at: null,
  }))
  const stats = getMonthlyStatistics(many, [], '2026-10', now)
  assert.equal(stats.remainingMinutes, 0)
  assert.equal(stats.balanceMinutes, 480)
})

test('shift countdown includes lunch and rounds to a departure that fulfils the work requirement', () => {
  const arrival = new Date('2026-10-07T06:00:00Z')
  const end = calculateShiftEnd(arrival, 480, false)
  assert.equal(end.toISOString(), '2026-10-07T14:30:00.000Z')
  assert.equal(calculateMinutesUntil(end, arrival), 510)
  assert.equal(calculateMinutesUntil(end, new Date('2026-10-07T14:00:00Z')), 30)
  assert.equal(calculateMinutesUntil(end, new Date('2026-10-07T14:30:01Z')), 0)
  assert.equal(calculateShiftEnd(arrival, 480, true).getTime(), end.getTime())

  // A lunch deducted in an earlier session must not extend this session again.
  assert.equal(calculateShiftEnd(arrival, 480, false, false).toISOString(), '2026-10-07T14:00:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 240, false).toISOString(), '2026-10-07T10:00:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 300, false).toISOString(), '2026-10-07T11:00:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 301, false).toISOString(), '2026-10-07T11:45:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 240, true).toISOString(), '2026-10-07T10:30:00.000Z')
  assert.equal(calculateShiftEnd(arrival, 0, true).getTime(), arrival.getTime())

  const lateArrival = new Date('2026-10-07T06:07:00Z')
  const lateEnd = calculateShiftEnd(lateArrival, 480, false)
  assert.equal(lateEnd.toISOString(), '2026-10-07T14:45:00.000Z')
  assert.equal(calculateWorkedMinutes(lateArrival, lateEnd, false), 480)
  assert.ok(calculateWorkedMinutes(lateArrival, new Date(lateEnd.getTime() - 60_000), false) < 480)
})

test('planned departure countdown uses wall-clock time independently of the shift requirement', () => {
  const now = new Date('2026-10-07T06:00:00Z')
  const planned = new Date('2026-10-07T15:30:00Z')
  assert.equal(calculateMinutesUntil(planned, now), 570)
  assert.equal(calculateMinutesUntil(planned, new Date('2026-10-07T15:29:30Z')), 1)
  assert.equal(calculateMinutesUntil(planned, new Date('2026-10-07T15:31:00Z')), 0)
})

test('company-wide leave shares vacation allowance and credits the day once', () => {
  const days = [
    { date: '2026-10-01', type: 'vacation', duration_minutes: 240 },
    { date: '2026-10-02', type: 'mandatory_vacation', duration_minutes: 480 },
    { date: '2026-10-05', type: 'sick_day', duration_minutes: 480 },
  ]
  assert.equal(getVacationUsedMinutes(days), 720)
  assert.equal(leaveLabels.mandatory_vacation, 'Celozávodní dovolená')
  const balance = calculateDailyBalances([], [days[1]])[0]
  assert.equal(balance.creditedMinutes, 480)
  assert.equal(balance.balanceMinutes, 0)
  assert.equal(balance.overtimeChangeMinutes, 0)
})

test('admin statistics separate monthly work, cumulative overtime and annual planned leave', () => {
  const stats = getUserStatistics([
    { started_at: '2026-09-30T06:00:00Z', ended_at: '2026-09-30T15:00:00Z', lunch_started_at: null },
    { started_at: '2026-10-01T06:00:00Z', ended_at: '2026-10-01T14:30:00Z', lunch_started_at: null },
  ], [
    { date: '2026-10-02', type: 'mandatory_vacation', duration_minutes: 480 },
    { date: '2026-10-20', type: 'vacation', duration_minutes: 480 },
    { date: '2027-01-01', type: 'vacation', duration_minutes: 480 },
  ], '2026-10', 480, new Date('2026-10-02T10:00:00Z'))
  assert.equal(stats.workedMinutes, 480)
  assert.equal(stats.overtimeMinutes, 30)
  assert.equal(stats.vacationMinutes, 960)
  assert.equal(stats.monthlySessions.length, 1)
  assert.equal(stats.monthlyDays.length, 2)
})

test('invitation states include expiration, revocation and consumption', () => {
  const invitation = {
    id: 'fixture', email: null, created_at: '2026-10-01T00:00:00Z',
    expires_at: '2026-10-03T00:00:00Z', used_at: null, revoked_at: null,
  }
  const now = new Date('2026-10-02T00:00:00Z')
  assert.equal(getInvitationStatus(invitation, now), 'Aktivní')
  assert.equal(getInvitationStatus(invitation, new Date(invitation.expires_at)), 'Vypršela')
  assert.equal(getInvitationStatus({ ...invitation, revoked_at: now.toISOString() }, now), 'Zrušena')
  assert.equal(getInvitationStatus({ ...invitation, used_at: now.toISOString() }, now), 'Použita')
})

test('role response validation rejects unexpected or client-supplied roles', () => {
  const user = {
    id: 'fixture', email: null, full_name: 'Test', role: 'user',
    daily_work_minutes: 480, created_at: '2026-10-01T00:00:00Z',
  }
  assert.equal(isAdminUser(user), true)
  assert.equal(isAdminUser({ ...user, role: 'owner' }), false)
  assert.equal(isAdminUser({ role: 'admin' }), false)
})

test('only one lunch is deducted per Prague day', () => {
  // Prague is UTC+2 on these dates.
  const morning = { started_at: '2026-10-06T05:00:00Z', ended_at: '2026-10-06T11:00:00Z', lunch_started_at: null }
  const afternoon = { started_at: '2026-10-06T12:00:00Z', ended_at: '2026-10-06T18:00:00Z', lunch_started_at: null }
  const automatic = getDailyLunchDeductions([afternoon, morning])
  assert.equal(automatic.get(morning), 'automatic')
  assert.equal(automatic.get(afternoon), null)
  // 6 h + 6 h with a single 30-minute lunch.
  assert.equal(calculateDailyBalances([morning, afternoon], [])[0].workedMinutes, 690)

  const recordedLater = { ...afternoon, lunch_started_at: '2026-10-06T13:00:00Z' }
  const withRecorded = getDailyLunchDeductions([morning, recordedLater])
  assert.equal(withRecorded.get(morning), null)
  assert.equal(withRecorded.get(recordedLater), 'recorded')

  const first = { started_at: '2026-10-06T05:00:00Z', ended_at: '2026-10-06T07:00:00Z', lunch_started_at: '2026-10-06T06:00:00Z' }
  const second = { started_at: '2026-10-06T08:00:00Z', ended_at: '2026-10-06T10:00:00Z', lunch_started_at: '2026-10-06T09:00:00Z' }
  const duplicates = getDailyLunchDeductions([second, first])
  assert.equal(duplicates.get(first), 'recorded')
  assert.equal(duplicates.get(second), null)
  assert.equal(calculateDailyBalances([first, second], [])[0].workedMinutes, 210)

  const open = { started_at: '2026-10-06T12:00:00Z', ended_at: null, lunch_started_at: null }
  assert.equal(hasLunchOnDate([open], '2026-10-06'), false)
  assert.equal(hasLunchOnDate([morning, open], '2026-10-06'), true)
  assert.equal(hasLunchOnDate([morning, open], '2026-10-07'), false)
})

const { validateSessionChange } = loadModule(resolve('src/lib/sessions.ts'))

test('session changes reject overlaps, future times and a second lunch', () => {
  const now = new Date('2030-04-01T16:00:00Z')
  const sessions = [
    { id: 1, started_at: '2030-04-01T06:00:00Z', ended_at: '2030-04-01T10:00:00Z', lunch_started_at: '2030-04-01T09:00:00Z' },
    { id: 2, started_at: '2030-04-01T13:00:00Z', ended_at: null, lunch_started_at: null },
  ]
  const change = (id, arrival, departure, lunchStartedAt = null) => validateSessionChange(
    { id, arrival: new Date(arrival), departure: departure && new Date(departure), lunchStartedAt },
    sessions, now,
  )

  assert.equal(change(null, '2030-04-01T10:00:00Z', '2030-04-01T12:00:00Z'), null)
  assert.match(change(null, '2030-04-01T09:00:00Z', '2030-04-01T11:00:00Z'), /překrývá/)
  assert.match(change(null, '2030-04-01T14:00:00Z', '2030-04-01T15:00:00Z'), /probíhá/)
  assert.match(change(null, '2030-04-01T11:00:00Z', '2030-04-01T10:00:00Z'), /později/)
  assert.match(change(null, '2030-04-01T15:00:00Z', '2030-04-01T17:00:00Z'), /budoucnosti/)
  assert.match(change(2, '2030-04-01T09:30:00Z', null), /překrývá/)
  assert.equal(change(2, '2030-04-01T12:00:00Z', null), null)
  assert.match(change(1, '2030-04-01T09:30:00Z', '2030-04-01T10:00:00Z', sessions[0].lunch_started_at), /oběda/)
  sessions[1].lunch_started_at = '2030-04-01T14:00:00Z'
  assert.match(change(2, '2030-04-01T13:00:00Z', null, sessions[1].lunch_started_at), /oběd/)
  assert.match(change(null, new Date('invalid'), null), /platný/)
})
