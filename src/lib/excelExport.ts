import ExcelJS from 'exceljs'
import { duration, EXPORT_HEADERS, getAttendanceExportDays } from './export'
import type { ExportLeave } from './export'
import type { MonthlySession } from './monthly'
import { leaveLabels } from './leave'

export const EXPORT_COLOURS = {
  holiday: 'FFF3CD',
  leave: 'DBEAFE',
  doctor: 'DCFCE7',
  extra: 'DCFCE7',
  missing: 'FEE2E2',
  pending: 'FFEDD5',
  weekend: 'F1F5F9',
}

function fill(cell: ExcelJS.Cell, colour: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${colour}` } }
}

export async function createAttendanceExcel(
  sessions: MonthlySession[],
  leave: ExportLeave[],
  period: string,
  now: Date,
  dailyMinutes = 480,
): Promise<Uint8Array> {
  const days = getAttendanceExportDays(sessions, leave, period, now, dailyMinutes)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Docházka'
  workbook.created = now
  const months = period.length === 4
    ? Array.from({ length: 12 }, (_, index) => `${period}-${String(index + 1).padStart(2, '0')}`)
    : [period]

  for (const month of months) {
    const label = new Intl.DateTimeFormat('cs-CZ', { month: 'long', timeZone: 'UTC' })
      .format(new Date(`${month}-01T00:00:00Z`))
    const sheet = workbook.addWorksheet(`${label} ${month.slice(0, 4)}`)
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.columns = EXPORT_HEADERS.map((header, index) => ({
      header, width: index === 8 ? 65 : index === 9 ? 40 : index === 6 || index === 7 ? 24 : 18,
    }))
    const monthDays = days.filter((day) => day.date.startsWith(month))
    for (const { values } of monthDays) {
      // Strings are intentionally stored as text, never as spreadsheet formulas.
      const row = sheet.addRow(values)
      row.alignment = { vertical: 'top', wrapText: true }
      const statuses = values[9].split(' · ')
      const colour = statuses.includes('Lékař') ? EXPORT_COLOURS.doctor
        : statuses.includes('Svátek') ? EXPORT_COLOURS.holiday
        : statuses.some((status) => ['Dovolená', 'Sick day', 'Náhradní volno', 'Celozávodní dovolená'].includes(status))
          ? EXPORT_COLOURS.leave
          : statuses.includes('Víkend') ? EXPORT_COLOURS.weekend : null
      if (colour) row.eachCell((cell) => fill(cell, colour))
      const balanceColour = statuses.includes('Chybí hodiny') ? EXPORT_COLOURS.missing
        : statuses.includes('Nad denní plán') ? EXPORT_COLOURS.extra : null
      const statusColour = statuses.includes('Neukončená docházka') || statuses.includes('Probíhající den')
        ? EXPORT_COLOURS.pending : balanceColour
      if (!colour && balanceColour) row.eachCell((cell) => fill(cell, balanceColour))
      if (balanceColour) fill(row.getCell(6), balanceColour)
      if (statusColour && !statuses.includes('Lékař')) fill(row.getCell(10), statusColour)
      if (statuses.includes('Budoucí den')) row.font = { color: { argb: 'FF64748B' } }
    }
    sheet.getRow(1).eachCell((cell) => {
      fill(cell, '5B21B6')
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    })
    sheet.getRow(1).height = 28
    sheet.autoFilter = { from: 'A1', to: `J${sheet.rowCount}` }
    const sum = (getMinutes: (day: typeof monthDays[number]) => number) =>
      monthDays.reduce((total, day) => total + getMinutes(day), 0)
    const total = sheet.addRow([
      'CELKEM', '', duration(sum((day) => day.requiredMinutes)),
      duration(sum((day) => day.creditedMinutes)), duration(sum((day) => day.lunchMinutes)),
      duration(sum((day) => day.balanceMinutes ?? 0), true),
    ])
    total.font = { bold: true }
    total.eachCell((cell) => fill(cell, 'EDE9FE'))
    sheet.addRow([])
    const summary = sheet.addRow(['Souhrn měsíce', 'Hodiny'])
    summary.font = { bold: true }
    const metrics: [string, number][] = [
      ['Odpracováno (bez volna a oběda)', sum((day) => day.workedMinutes)],
      ['Nad denní plán', sum((day) => Math.max(0, day.balanceMinutes ?? 0))],
      ['Chybějící hodiny', sum((day) => Math.max(0, -(day.balanceMinutes ?? 0)))],
      ['Změna přesčasového účtu', sum((day) => day.overtimeChangeMinutes ?? 0)],
      ...Object.entries(leaveLabels).map(([type, label]): [string, number] => [
        label, sum((day) => day.leaveMinutes[type as ExportLeave['type']]),
      ]),
    ]
    for (const [label, minutes] of metrics) {
      const row = sheet.addRow([label, duration(minutes, label === 'Změna přesčasového účtu')])
      row.alignment = { vertical: 'top', wrapText: true }
      if (label === 'Lékař') row.eachCell((cell) => fill(cell, EXPORT_COLOURS.doctor))
    }
  }

  const legend = workbook.addWorksheet('Legenda')
  legend.columns = [{ header: 'Označení', width: 30 }, { header: 'Význam', width: 95 }]
  const entries: [string, string, string][] = [
    ['Svátek', 'Placený svátek; ve všední den započten do fondu. O víkendu bez dalších hodin.', EXPORT_COLOURS.holiday],
    ['Volno', 'Dovolená, sick day, náhradní nebo celozávodní volno.', EXPORT_COLOURS.leave],
    ['Lékař', 'Vždy zeleně (bilance má vlastní barvu). Lékař 08:30–14:00 placený, mimo toto okno čerpá přesčasy.', EXPORT_COLOURS.doctor],
    ['Nad denní plán', 'Kladná denní bilance. Není to zůstatek přesčasového účtu.', EXPORT_COLOURS.extra],
    ['Chybí hodiny', 'Záporná bilance minulého dne, včetně dnů bez záznamu.', EXPORT_COLOURS.missing],
    ['Neukončeno / probíhá', 'Otevřená docházka nebo dosud nesplněný dnešní den. Nejde o uzavřený nedostatek.', EXPORT_COLOURS.pending],
    ['Víkend', 'Denní plán je nulový; případná dokončená práce se započítá.', EXPORT_COLOURS.weekend],
  ]
  for (const [label, explanation, colour] of entries) {
    const row = legend.addRow([label, explanation])
    fill(row.getCell(1), colour)
    row.alignment = { wrapText: true, vertical: 'top' }
  }
  legend.addRow(['Budoucí den', 'Šedý text; volno a svátky dosud nezapočteny, bilance je prázdná.'])
  legend.addRow(['Časy a hodiny', 'Časové pásmo Europe/Prague. Započteno je čistá dokončená práce a uznané volno/svátky. Přestávka je jednou odečtený oběd.'])
  legend.addRow(['Počátek / konec', 'Skutečné časy před zaokrouhlením; více záznamů je sečteno do jednoho dne podle data příchodu.'])
  legend.addRow(['Souhrn měsíce', 'CELKEM sčítá plán celého měsíce, započtené hodiny, obědy a dosavadní denní bilance. Rozpis volna zahrnuje pouze uznané hodiny, ne budoucí plány ani volno o víkendu nebo svátku. Lékař zahrnuje placenou část i čerpání přesčasů.'])
  legend.addRow(['Změna přesčasového účtu', 'Stejný výpočet jako v aplikaci, pouze za tento měsíc, včetně čerpání náhradního volna a lékaře mimo placené okno. Dny bez záznamu ani nedokončený dnešní den se do účtu neúčtují. Nejde o roční zůstatek.'])
  legend.eachRow((row) => { row.alignment = { wrapText: true, vertical: 'top' } })
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
