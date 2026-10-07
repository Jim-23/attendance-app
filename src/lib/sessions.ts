import { formatInTimeZone } from 'date-fns-tz'
import { APP_TIMEZONE, formatTime } from './time'

export interface SessionRecord {
  id: number
  started_at: string
  ended_at: string | null
  lunch_started_at: string | null
}

export interface SessionChange {
  id: number | null
  arrival: Date
  // null keeps the session open (only the arrival is being changed).
  departure: Date | null
  lunchStartedAt: string | null
}

// Time inputs have minute precision, so allow the current minute.
const FUTURE_TOLERANCE_MS = 60_000

function getPragueDate(date: Date): string {
  return formatInTimeZone(date, APP_TIMEZONE, 'yyyy-MM-dd')
}

/**
 * Ověří nový nebo upravený pracovní záznam proti ostatním záznamům
 * uživatele. Vrací českou chybovou hlášku, nebo null, pokud je vše v pořádku.
 */
export function validateSessionChange(
  change: SessionChange,
  sessions: SessionRecord[],
  now = new Date(),
): string | null {
  const { id, arrival, departure, lunchStartedAt } = change

  if (
    !Number.isFinite(arrival.getTime()) ||
    (departure !== null && !Number.isFinite(departure.getTime()))
  ) {
    return 'Zadej platný čas příchodu a odchodu.'
  }

  const latestAllowed = now.getTime() + FUTURE_TOLERANCE_MS

  if (arrival.getTime() > latestAllowed) {
    return 'Příchod nemůže být v budoucnosti.'
  }

  if (departure !== null) {
    if (arrival >= departure) {
      return 'Odchod musí být později než příchod.'
    }

    if (departure.getTime() > latestAllowed) {
      return 'Odchod nemůže být v budoucnosti.'
    }
  }

  if (lunchStartedAt) {
    const lunch = new Date(lunchStartedAt)
    if (lunch < arrival || (departure !== null && lunch >= departure)) {
      return 'Upravený čas musí zahrnovat již zaznamenaný začátek oběda.'
    }
  }

  const end = departure?.getTime() ?? Number.POSITIVE_INFINITY
  const others = sessions.filter((session) => session.id !== id)

  const overlapping = others.find((session) => {
    const otherStart = new Date(session.started_at).getTime()
    const otherEnd = session.ended_at
      ? new Date(session.ended_at).getTime()
      : Number.POSITIVE_INFINITY

    return otherStart < end && arrival.getTime() < otherEnd
  })

  if (overlapping) {
    const range = overlapping.ended_at
      ? `${formatTime(overlapping.started_at)}–${formatTime(overlapping.ended_at)}`
      : `od ${formatTime(overlapping.started_at)}, probíhá`

    return `Docházka se překrývá s jiným záznamem (${range}).`
  }

  if (lunchStartedAt) {
    const date = getPragueDate(arrival)
    const lunchOnSameDay = others.some(
      (session) =>
        session.lunch_started_at !== null &&
        getPragueDate(new Date(session.started_at)) === date,
    )

    if (lunchOnSameDay) {
      return 'V tento den už je zaznamenaný oběd.'
    }
  }

  return null
}
