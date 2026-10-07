import { useState } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import {
  calculateWorkedMinutes,
  formatDuration,
  getAutomaticLunchStart,
  getDailyLunchDeductions,
} from '../lib/attendance'
import { APP_TIMEZONE, formatTime } from '../lib/time'
import { getCzechHolidays, getMonthDays, shiftMonth } from '../lib/calendar'
import { leaveLabels } from '../lib/leave'

interface CalendarSession {
  id: number
  started_at: string
  ended_at: string | null
  lunch_started_at: string | null
}

interface CalendarLeave {
  id: number
  date: string
  type: 'holiday' | 'vacation' | 'sick_day' | 'comp_time' | 'mandatory_vacation'
  duration_minutes: number
  note: string | null
}

interface AttendanceCalendarProps {
  sessions: CalendarSession[]
  workDays: CalendarLeave[]
  today: string
  selectedDate?: string | null
  onSelectDate?: (date: string) => void
}

function AttendanceCalendar({
  sessions,
  workDays,
  today,
  selectedDate = null,
  onSelectDate,
}: AttendanceCalendarProps) {
  const [month, setMonth] = useState(today.slice(0, 7))
  const days = getMonthDays(month)
  const holidays = new Map(
    [...new Set(days.map((day) => Number(day.date.slice(0, 4))))]
      .flatMap((year) => [...getCzechHolidays(year)]),
  )
  const monthLabel = new Intl.DateTimeFormat('cs-CZ', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`))

  const sessionsByDate = new Map<string, CalendarSession[]>()
  for (const session of sessions) {
    const date = formatInTimeZone(new Date(session.started_at), APP_TIMEZONE, 'yyyy-MM-dd')
    const records = sessionsByDate.get(date) ?? []
    records.push(session)
    sessionsByDate.set(date, records)
  }

  const lunchDeductions = getDailyLunchDeductions(sessions)

  const leaveByDate = new Map<string, CalendarLeave[]>()
  for (const record of workDays) {
    const records = leaveByDate.get(record.date) ?? []
    records.push(record)
    leaveByDate.set(record.date, records)
  }

  return (
    <section className="dashboard-section" aria-labelledby="calendar-heading">
      <div className="calendar-heading">
        <div className="section-heading">
          <p className="section-eyebrow">MĚSÍČNÍ PŘEHLED</p>
          <h2 id="calendar-heading">Kalendář</h2>
        </div>
        <div className="calendar-controls">
          <button className="button button-secondary button-small" aria-label="Předchozí měsíc"
            onClick={() => setMonth(shiftMonth(month, -1))}>&lt;</button>
          <h3 aria-live="polite">{monthLabel}</h3>
          <button className="button button-secondary button-small" aria-label="Následující měsíc"
            onClick={() => setMonth(shiftMonth(month, 1))}>&gt;</button>
          <button className="button button-secondary button-small"
            onClick={() => setMonth(today.slice(0, 7))}>Dnes</button>
        </div>
      </div>
      <p className="calendar-note">
        Přehled docházky, volna a českých svátků. České svátky se automaticky odečítají z měsíčního fondu.
        {onSelectDate && ' Kliknutím na den můžeš upravit docházku a volno.'}
      </p>
      <div className="calendar-scroll">
        <table className="calendar-table">
          <caption className="sr-only">{monthLabel}: docházka, volno a svátky</caption>
          <thead>
            <tr>{['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((day) => (
              <th key={day} scope="col">{day}</th>
            ))}</tr>
          </thead>
          <tbody>
            {Array.from({ length: days.length / 7 }, (_, week) => (
              <tr key={week}>
                {days.slice(week * 7, week * 7 + 7).map((day) => (
                  <td key={day.date} className={[
                    !day.inMonth ? 'calendar-outside' : '',
                    day.weekend ? 'calendar-weekend' : '',
                    day.date === today ? 'calendar-today' : '',
                    day.date === selectedDate ? 'calendar-selected' : '',
                    onSelectDate ? 'calendar-editable' : '',
                  ].join(' ')}
                  onClick={onSelectDate ? () => onSelectDate(day.date) : undefined}>
                    {onSelectDate ? (
                      <button
                        type="button"
                        className="calendar-day-button"
                        aria-label={`Upravit ${new Intl.DateTimeFormat('cs-CZ', {
                          day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
                        }).format(new Date(`${day.date}T00:00:00Z`))}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelectDate(day.date)
                        }}
                      >
                        <time dateTime={day.date} aria-current={day.date === today ? 'date' : undefined}>
                          {Number(day.date.slice(8))}{day.date === today && ' · dnes'}
                        </time>
                      </button>
                    ) : (
                      <time dateTime={day.date} aria-current={day.date === today ? 'date' : undefined}>
                        {Number(day.date.slice(8))}{day.date === today && ' · dnes'}
                      </time>
                    )}
                    {holidays.has(day.date) && (
                      <p className="calendar-event calendar-holiday">{holidays.get(day.date)}</p>
                    )}
                    {(sessionsByDate.get(day.date) ?? []).map((session) => {
                      const lunchDeduction = lunchDeductions.get(session) ?? null
                      const automaticLunch = session.ended_at
                        ? getAutomaticLunchStart(
                            new Date(session.started_at), new Date(session.ended_at),
                            false, lunchDeduction === 'automatic',
                          )
                        : null
                      return (
                      <p key={session.id} className="calendar-event calendar-work">
                        {formatTime(session.started_at)} – {session.ended_at
                          ? formatTime(session.ended_at) : 'probíhá'}
                        {session.ended_at && (
                          <span>{formatDuration(calculateWorkedMinutes(
                            new Date(session.started_at), new Date(session.ended_at),
                            lunchDeduction === 'recorded', lunchDeduction === 'automatic',
                          ), false)}</span>
                        )}
                        {session.lunch_started_at
                          ? <span>Oběd {formatTime(session.lunch_started_at)} {lunchDeduction === 'recorded'
                            ? '(30 min)' : '(nezapočteno)'}</span>
                          : automaticLunch && (
                            <span>Automatický oběd {formatTime(automaticLunch.toISOString())} (30 min)</span>
                          )}
                      </p>
                      )
                    })}
                    {(leaveByDate.get(day.date) ?? []).map((record) => (
                      <p key={record.id} className="calendar-event calendar-leave" title={record.note ?? undefined}>
                        {leaveLabels[record.type]}
                        <span>{formatDuration(record.duration_minutes, false)}</span>
                        {record.note && <span>{record.note}</span>}
                      </p>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default AttendanceCalendar
