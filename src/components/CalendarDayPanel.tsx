import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { formatInTimeZone } from 'date-fns-tz'
import { TimeInput } from './TimeInput'
import {
  calculateCurrentWorkedMinutes,
  calculateSessionWorkedMinutes,
  formatDuration,
  getDailyLunchDeductions,
} from '../lib/attendance'
import { leaveLabels } from '../lib/leave'
import type { LeaveInput, UserLeaveType } from '../lib/leave'
import type { SessionChange } from '../lib/sessions'
import { APP_TIMEZONE, formatTime, parseDateTimeLocal } from '../lib/time'
import DoctorTimeInput, { DoctorVisitDetails } from './DoctorTimeInput'

interface PanelSession {
  id: number
  started_at: string
  ended_at: string | null
  lunch_started_at: string | null
}

interface PanelLeave {
  id: number
  date: string
  type: 'holiday' | UserLeaveType
  duration_minutes: number
  note: string | null
  doctor_from?: string | null
  doctor_to?: string | null
}

interface CalendarDayPanelProps {
  date: string
  today: string
  holiday?: string
  sessions: PanelSession[]
  leave: PanelLeave[]
  allLeave: PanelLeave[]
  busy: boolean
  message: ReactNode
  onClose: () => void
  onSaveSession: (change: SessionChange) => Promise<boolean>
  onDeleteSession: (id: number) => Promise<void>
  onAddLeave: (input: LeaveInput) => Promise<boolean>
  onDeleteLeave: (id: number) => Promise<void>
}

function toPragueTime(timestamp: string): string {
  return formatInTimeZone(new Date(timestamp), APP_TIMEZONE, 'HH:mm')
}

function toPragueDate(timestamp: string): string {
  return formatInTimeZone(new Date(timestamp), APP_TIMEZONE, 'yyyy-MM-dd')
}

function CalendarDayPanel({
  date,
  today,
  holiday,
  sessions,
  leave,
  allLeave,
  busy,
  message,
  onClose,
  onSaveSession,
  onDeleteSession,
  onAddLeave,
  onDeleteLeave,
}: CalendarDayPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [arrival, setArrival] = useState('08:00')
  const [departure, setDeparture] = useState('16:30')
  const [leaveType, setLeaveType] = useState<UserLeaveType>('vacation')
  const [leaveDuration, setLeaveDuration] = useState(480)
  const [compHours, setCompHours] = useState(0)
  const [compMinutes, setCompMinutes] = useState(15)
  const [leaveNote, setLeaveNote] = useState('')
  const [doctorFrom, setDoctorFrom] = useState('08:30')
  const [doctorTo, setDoctorTo] = useState('09:23')

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [])

  const isFuture = date > today
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const isWeekend = weekday === 0 || weekday === 6
  const title = new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))

  const lunchDeductions = getDailyLunchDeductions(sessions)
  const sortedSessions = [...sessions].sort(
    (left, right) =>
      new Date(left.started_at).getTime() - new Date(right.started_at).getTime(),
  )

  function startEditing(session: PanelSession) {
    setEditingId(session.id)
    setArrival(toPragueTime(session.started_at))
    setDeparture(session.ended_at ? toPragueTime(session.ended_at) : '')
  }

  function startAdding() {
    setEditingId('new')
    setArrival('06:00')
    setDeparture('14:30')
  }

  async function handleSaveSession(event: FormEvent, session?: PanelSession) {
    event.preventDefault()

    const saved = await onSaveSession({
      id: session?.id ?? null,
      arrival: parseDateTimeLocal(`${date}T${arrival}`),
      departure:
        session && !session.ended_at
          ? null
          : parseDateTimeLocal(`${date}T${departure}`),
      lunchStartedAt: session?.lunch_started_at ?? null,
    })

    if (saved) {
      setEditingId(null)
    }
  }

  async function handleAddLeave(event: FormEvent) {
    event.preventDefault()

    const saved = await onAddLeave({
      type: leaveType,
      dateFrom: date,
      dateTo: '',
      durationMinutes:
        leaveType === 'comp_time'
          ? compHours * 60 + compMinutes
          : leaveType === 'vacation'
            ? leaveDuration
            : 480,
      note: leaveNote,
      doctorFrom,
      doctorTo,
    })

    if (saved) {
      setLeaveNote('')
      setLeaveDuration(480)
      setCompHours(0)
      setCompMinutes(15)
    }
  }

  function renderSessionForm(session?: PanelSession) {
    const open = session !== undefined && !session.ended_at

    return (
      <form
        className="day-panel-form"
        onSubmit={(event) => void handleSaveSession(event, session)}
      >
        <div className="form-field">
          <label htmlFor="day-panel-arrival">Příchod</label>
          <TimeInput
            id="day-panel-arrival"
            value={arrival}
            onChange={setArrival}
            disabled={busy}
            autoFocus
          />
        </div>
        {!open && (
          <div className="form-field">
            <label htmlFor="day-panel-departure">Odchod</label>
            <TimeInput
              id="day-panel-departure"
              value={departure}
              onChange={setDeparture}
              disabled={busy}
            />
          </div>
        )}
        <div className="day-panel-actions">
          <button type="submit" className="button button-primary button-small" disabled={busy}>
            {busy ? 'Ukládám...' : 'Uložit'}
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setEditingId(null)}
            disabled={busy}
          >
            Zrušit
          </button>
        </div>
      </form>
    )
  }

  return (
    <dialog
      ref={dialogRef}
      className="day-panel"
      aria-labelledby="day-panel-title"
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault()
      }}
    >
      <header className="day-panel-header">
        <div>
          <p className="section-eyebrow">ÚPRAVA DNE</p>
          <h2 id="day-panel-title">{title}</h2>
          {holiday && <p className="day-panel-holiday">{holiday}</p>}
        </div>
        <button
          type="button"
          className="message-close"
          aria-label="Zavřít"
          onClick={() => dialogRef.current?.close()}
          disabled={busy}
        >
          ×
        </button>
      </header>

      {message}

      <section className="day-panel-section" aria-labelledby="day-panel-sessions">
        <h3 id="day-panel-sessions">Docházka</h3>
        {sortedSessions.length === 0 && <p className="calendar-note">Žádná docházka.</p>}
        <ul className="day-panel-list">
          {sortedSessions.map((session) => {
            const deduction = lunchDeductions.get(session) ?? null
            const crossesMidnight =
              session.ended_at !== null && toPragueDate(session.ended_at) !== date
            const worked = session.ended_at
              ? calculateSessionWorkedMinutes(
                  { ...session, ended_at: session.ended_at },
                  deduction,
                  allLeave,
                )
              : calculateCurrentWorkedMinutes(
                  new Date(session.started_at),
                  new Date(),
                  session.lunch_started_at !== null,
                  allLeave,
                  session.lunch_started_at,
                )

            return (
              <li key={session.id} className="day-panel-item">
                {editingId === session.id ? (
                  renderSessionForm(session)
                ) : (
                  <>
                    <div>
                      <strong>
                        {formatTime(session.started_at)} –{' '}
                        {session.ended_at ? formatTime(session.ended_at) : 'probíhá'}
                      </strong>
                      <span className="day-panel-meta">
                        Odpracováno {formatDuration(worked, false)}
                        {session.lunch_started_at &&
                          ` · oběd ${formatTime(session.lunch_started_at)}`}
                        {deduction === 'automatic' && ' · automatický oběd'}
                      </span>
                      {crossesMidnight && (
                        <span className="day-panel-meta">
                          Docházka přes půlnoc – uprav ji v Historii.
                        </span>
                      )}
                    </div>
                    <div className="day-panel-actions">
                      {!crossesMidnight && (
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() => startEditing(session)}
                          disabled={busy || editingId !== null}
                        >
                          Upravit
                        </button>
                      )}
                      <button
                        type="button"
                        className="button button-danger button-small"
                        onClick={() => void onDeleteSession(session.id)}
                        disabled={busy || editingId !== null}
                      >
                        Smazat
                      </button>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
        {isFuture ? (
          <p className="calendar-note">Docházku nelze zadat do budoucnosti.</p>
        ) : editingId === 'new' ? (
          renderSessionForm()
        ) : (
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={startAdding}
            disabled={busy || editingId !== null}
          >
            Přidat docházku
          </button>
        )}
      </section>

      <section className="day-panel-section" aria-labelledby="day-panel-leave">
        <h3 id="day-panel-leave">Volno</h3>
        {leave.length === 0 && <p className="calendar-note">Žádné volno.</p>}
        <ul className="day-panel-list">
          {leave.map((record) => (
            <li key={record.id} className="day-panel-item">
              <div>
                <strong>{leaveLabels[record.type]}</strong>
                <span className="day-panel-meta">
                  {formatDuration(record.duration_minutes, false)}
                  {record.note && ` · ${record.note}`}
                </span>
                {record.doctor_from && record.doctor_to &&
                  <DoctorVisitDetails from={record.doctor_from} to={record.doctor_to} />}
              </div>
              <button
                type="button"
                className="button button-danger button-small"
                onClick={() => void onDeleteLeave(record.id)}
                disabled={busy}
              >
                Smazat
              </button>
            </li>
          ))}
        </ul>
        {isWeekend ? (
          <p className="calendar-note">Volno lze zadat jen na pracovní den.</p>
        ) : (
          <form className="day-panel-form" onSubmit={(event) => void handleAddLeave(event)}>
            <div className="form-field">
              <label htmlFor="day-panel-leave-type">Typ</label>
              <select
                id="day-panel-leave-type"
                value={leaveType}
                disabled={busy}
                onChange={(event) => setLeaveType(event.target.value as UserLeaveType)}
              >
                <option value="vacation">{leaveLabels.vacation}</option>
                <option value="sick_day">{leaveLabels.sick_day}</option>
                <option value="comp_time">{leaveLabels.comp_time}</option>
                <option value="mandatory_vacation">{leaveLabels.mandatory_vacation}</option>
                <option value="doctor">{leaveLabels.doctor}</option>
              </select>
            </div>
            {leaveType === 'doctor' && (
              <DoctorTimeInput id="panel-doctor" from={doctorFrom} to={doctorTo}
                onFrom={setDoctorFrom} onTo={setDoctorTo} disabled={busy} />
            )}
            {leaveType === 'vacation' && (
              <div className="form-field">
                <label htmlFor="day-panel-leave-duration">Délka</label>
                <select
                  id="day-panel-leave-duration"
                  value={leaveDuration}
                  disabled={busy}
                  onChange={(event) => setLeaveDuration(Number(event.target.value))}
                >
                  <option value={480}>Celý den (8 h)</option>
                  <option value={240}>Půl dne (4 h)</option>
                </select>
              </div>
            )}
            {leaveType === 'comp_time' && (
              <>
                <div className="form-field">
                  <label htmlFor="day-panel-comp-hours">Hodiny</label>
                  <input
                    id="day-panel-comp-hours"
                    type="number"
                    min="0"
                    max="8"
                    value={compHours}
                    disabled={busy}
                    onChange={(event) => setCompHours(Number(event.target.value))}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="day-panel-comp-minutes">Minuty</label>
                  <select
                    id="day-panel-comp-minutes"
                    value={compMinutes}
                    disabled={busy}
                    onChange={(event) => setCompMinutes(Number(event.target.value))}
                  >
                    {[0, 15, 30, 45].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {String(minutes).padStart(2, '0')}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {(leaveType === 'sick_day' || leaveType === 'mandatory_vacation') && (
              <p className="calendar-note">Celý den (8 h).</p>
            )}
            <div className="form-field day-panel-wide">
              <label htmlFor="day-panel-leave-note">Poznámka</label>
              <input
                id="day-panel-leave-note"
                type="text"
                value={leaveNote}
                placeholder="Volitelná poznámka"
                disabled={busy}
                onChange={(event) => setLeaveNote(event.target.value)}
              />
            </div>
            <div className="day-panel-actions day-panel-wide">
              <button type="submit" className="button button-primary button-small" disabled={busy}>
                {busy ? 'Ukládám...' : 'Přidat volno'}
              </button>
            </div>
          </form>
        )}
      </section>
    </dialog>
  )
}

export default CalendarDayPanel
