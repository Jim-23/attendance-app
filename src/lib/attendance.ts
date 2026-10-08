import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { doctorOverlapMinutes, isDoctorBoundary, splitDoctorVisit } from './doctor'

const APP_TIMEZONE = 'Europe/Prague'
const LUNCH_MINUTES = 30
const AUTOMATIC_LUNCH_AFTER_MINUTES = 5 * 60

export interface WorkSessionForBalance {
  started_at: string
  ended_at: string
  lunch_started_at: string | null
}

export interface WorkDayForBalance {
  date: string
  type:
    | 'holiday'
    | 'vacation'
    | 'sick_day'
    | 'comp_time'
    | 'mandatory_vacation'
    | 'doctor'
  duration_minutes: number
  doctor_from?: string | null
  doctor_to?: string | null
}

export interface DailyBalance {
  date: string
  workedMinutes: number
  creditedMinutes: number
  compTimeMinutes: number
  balanceMinutes: number
  overtimeChangeMinutes: number
}

/**
 * Zaokrouhlí příchod nahoru na nejbližších 15 minut.
 */
export function roundArrival(date: Date): Date {
  const localTime = formatInTimeZone(
    date,
    APP_TIMEZONE,
    'yyyy-MM-dd HH:mm',
  )

  const [datePart, timePart] = localTime.split(' ')
  const [hours, minutes] = timePart.split(':').map(Number)

  const roundedMinutes = Math.ceil(minutes / 15) * 15

  let roundedHours = hours
  let finalMinutes = roundedMinutes

  if (roundedMinutes === 60) {
    roundedHours += 1
    finalMinutes = 0
  }

  const roundedLocalTime =
    `${datePart} ${String(roundedHours).padStart(2, '0')}:` +
    `${String(finalMinutes).padStart(2, '0')}:00`

  return fromZonedTime(
    roundedLocalTime,
    APP_TIMEZONE,
  )
}

/**
 * Zaokrouhlí odchod dolů na nejbližších 15 minut.
 */
export function roundDeparture(date: Date): Date {
  const localTime = formatInTimeZone(
    date,
    APP_TIMEZONE,
    'yyyy-MM-dd HH:mm',
  )

  const [datePart, timePart] = localTime.split(' ')
  const [hours, minutes] = timePart.split(':').map(Number)

  const roundedMinutes = Math.floor(minutes / 15) * 15

  const roundedLocalTime =
    `${datePart} ${String(hours).padStart(2, '0')}:` +
    `${String(roundedMinutes).padStart(2, '0')}:00`

  return fromZonedTime(
    roundedLocalTime,
    APP_TIMEZONE,
  )
}

export interface LunchSession {
  started_at: string
  ended_at: string | null
  lunch_started_at: string | null
}

export type LunchDeduction = 'recorded' | 'automatic' | null

function getPragueDate(timestamp: string): string {
  return formatInTimeZone(new Date(timestamp), APP_TIMEZONE, 'yyyy-MM-dd')
}

function getCountedAttendanceBounds(
  arrival: Date,
  departure: Date,
  workDays: WorkDayForBalance[],
): { start: Date; end: Date } {
  // A doctor interruption must not introduce another quarter-hour rounding loss.
  return {
    start: isDoctorBoundary(arrival, 'doctor_to', workDays) ? arrival : roundArrival(arrival),
    end: isDoctorBoundary(departure, 'doctor_from', workDays) ? departure : roundDeparture(departure),
  }
}

function exceedsAutomaticLunchThreshold(
  arrival: Date, departure: Date, workDays: WorkDayForBalance[],
): boolean {
  const { start, end } = getCountedAttendanceBounds(arrival, departure, workDays)
  const totalMinutes =
    (end.getTime() - start.getTime()) /
    (1000 * 60)

  return totalMinutes > AUTOMATIC_LUNCH_AFTER_MINUTES
}

/**
 * Každý den (podle data příchodu v Praze) má nejvýše jeden oběd.
 * Zaznamenaný oběd má přednost. Pokud v daný den žádný není,
 * automatický oběd dostane první dokončená session delší než 5 hodin.
 */
export function getDailyLunchDeductions<T extends LunchSession>(
  sessions: T[],
  workDays: WorkDayForBalance[] = [],
): Map<T, LunchDeduction> {
  const deductions = new Map<T, LunchDeduction>()
  const sessionsByDate = new Map<string, T[]>()

  for (const session of sessions) {
    deductions.set(session, null)
    const date = getPragueDate(session.started_at)
    const daySessions = sessionsByDate.get(date) ?? []
    daySessions.push(session)
    sessionsByDate.set(date, daySessions)
  }

  for (const daySessions of sessionsByDate.values()) {
    const ordered = [...daySessions].sort(
      (left, right) =>
        new Date(left.started_at).getTime() -
        new Date(right.started_at).getTime(),
    )

    const recorded = ordered.find(
      (session) => session.lunch_started_at !== null,
    )

    if (recorded) {
      deductions.set(recorded, 'recorded')
      continue
    }

    const automatic = ordered.find(
      (session) =>
        session.ended_at !== null &&
        exceedsAutomaticLunchThreshold(
          new Date(session.started_at),
          new Date(session.ended_at),
          workDays,
        ),
    )

    if (automatic) {
      deductions.set(automatic, 'automatic')
    }
  }

  return deductions
}

export function hasLunchOnDate(
  sessions: LunchSession[],
  date: string,
  workDays: WorkDayForBalance[] = [],
): boolean {
  const daySessions = sessions.filter(
    (session) => getPragueDate(session.started_at) === date,
  )
  const deductions = getDailyLunchDeductions(daySessions, workDays)

  return [...deductions.values()].some((deduction) => deduction !== null)
}

export function getAutomaticLunchStart(
  arrival: Date,
  departure: Date,
  hasLunch: boolean,
  allowAutomaticLunch = true,
  workDays: WorkDayForBalance[] = [],
): Date | null {
  if (hasLunch || !allowAutomaticLunch) {
    return null
  }

  const { start, end } = getCountedAttendanceBounds(arrival, departure, workDays)
  const totalMinutes =
    (end.getTime() - start.getTime()) /
    (1000 * 60)

  return totalMinutes > AUTOMATIC_LUNCH_AFTER_MINUTES
    ? new Date(
        start.getTime() +
          AUTOMATIC_LUNCH_AFTER_MINUTES * 60 * 1000,
      )
    : null
}

/**
 * Spočítá čistý odpracovaný čas.
 * Oběd má vždy 30 minut.
 */


export function calculateWorkedMinutes(
  arrival: Date,
  departure: Date,
  hasLunch: boolean,
  allowAutomaticLunch = true,
  workDays: WorkDayForBalance[] = [],
): number {
  const { start, end } = getCountedAttendanceBounds(arrival, departure, workDays)

  const totalMinutes =
    (end.getTime() -
      start.getTime()) /
    (1000 * 60)

  const lunchMinutes =
    hasLunch ||
    (allowAutomaticLunch &&
      totalMinutes > AUTOMATIC_LUNCH_AFTER_MINUTES)
      ? LUNCH_MINUTES
      : 0

  return Math.max(0, totalMinutes - lunchMinutes)
}


export function calculateSessionWorkedMinutes(
  session: WorkSessionForBalance,
  deduction: LunchDeduction,
  workDays: WorkDayForBalance[] = [],
): number {
  const arrival = new Date(session.started_at)
  const departure = new Date(session.ended_at)
  const { start, end } = getCountedAttendanceBounds(arrival, departure, workDays)
  const lunchStart = deduction === 'recorded' && session.lunch_started_at
    ? new Date(session.lunch_started_at)
    : getAutomaticLunchStart(arrival, departure, false, deduction === 'automatic', workDays)
  return Math.max(0, calculateWorkedMinutes(
    new Date(session.started_at),
    new Date(session.ended_at),
    deduction === 'recorded',
    deduction === 'automatic',
    workDays,
  ) - doctorOverlapMinutes(start, end, workDays, lunchStart))
}

export function calculateCurrentWorkedMinutes(
  arrival: Date,
  now: Date,
  hasLunch: boolean,
  workDays: WorkDayForBalance[] = [],
  lunchStartedAt: string | null = null,
): number {
  const { start, end } = getCountedAttendanceBounds(arrival, now, workDays)

  const totalMinutes =
    (end.getTime() -
      start.getTime()) /
    (1000 * 60)

  const lunchMinutes = hasLunch ? LUNCH_MINUTES : 0

  return Math.max(
    0,
    totalMinutes - lunchMinutes - doctorOverlapMinutes(
      start, end, workDays,
      hasLunch && lunchStartedAt ? new Date(lunchStartedAt) : null,
    ),
  )
}

export function calculateShiftEnd(
  arrival: Date,
  requiredWorkedMinutes: number,
  hasLunch: boolean,
  allowAutomaticLunch = true,
  workDays: WorkDayForBalance[] = [],
  lunchStartedAt: string | null = null,
): Date {
  if (requiredWorkedMinutes <= 0) return arrival

  const roundedWorkMinutes = Math.ceil(requiredWorkedMinutes / 15) * 15
  const lunchMinutes =
    hasLunch ||
    (allowAutomaticLunch && roundedWorkMinutes > AUTOMATIC_LUNCH_AFTER_MINUTES)
      ? LUNCH_MINUTES
      : 0

  let end = new Date(
    roundArrival(arrival).getTime() +
      (roundedWorkMinutes + lunchMinutes) * 60_000,
  )
  if (workDays.some((day) => day.type === 'doctor')) {
    const { start } = getCountedAttendanceBounds(arrival, arrival, workDays)
    end = roundDeparture(new Date(start.getTime() + requiredWorkedMinutes * 60_000))
    while (calculateSessionWorkedMinutes(
      {
        started_at: arrival.toISOString(), ended_at: end.toISOString(),
        lunch_started_at: hasLunch ? lunchStartedAt : null,
      },
      hasLunch ? 'recorded' : allowAutomaticLunch &&
        exceedsAutomaticLunchThreshold(arrival, end, workDays) ? 'automatic' : null,
      workDays,
    ) < requiredWorkedMinutes) {
      end = new Date(end.getTime() + 15 * 60_000)
    }
  }
  return end
}

export function calculateMinutesUntil(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 60_000))
}

/**
 * Spočítá bilanci jednoho dne.
 *
 * workedMinutes:
 *   skutečně odpracovaný čas
 *
 * creditedMinutes:
 *   uznané volno, například dovolená nebo sick day
 *
 * compTimeMinutes:
 *   náhradní volno
 *
 * Náhradní volno se započítává do pokrytí
 * denní pracovní povinnosti, ale zároveň se
 * eviduje samostatně, protože později odečítá
 * čas z průběžného přesčasového účtu.
 */
export function calculateDailyBalance(
  workedMinutes: number,
  creditedMinutes: number,
  compTimeMinutes: number,
  requiredMinutes = 480,
): number {
  return (
    workedMinutes +
    creditedMinutes +
    compTimeMinutes -
    requiredMinutes
  )
}

export function calculateOvertimeChange(
  workedMinutes: number,
  creditedMinutes: number,
  compTimeMinutes: number,
  requiredMinutes = 480,
): number {
  const baseBalance =
    workedMinutes +
    creditedMinutes -
    requiredMinutes

  const deficit = Math.max(0, -baseBalance)

  const compUsedForDeficit = Math.min(
    compTimeMinutes,
    deficit,
  )

  const extraCompTime =
    compTimeMinutes - compUsedForDeficit

  return baseBalance - extraCompTime
}

/**
 * Spočítá bilanci všech dnů, pro které existuje
 * pracovní session.
 *
 * Jeden den může mít více work_days záznamů.
 */
export function calculateDailyBalances(
  sessions: WorkSessionForBalance[],
  workDays: WorkDayForBalance[],
  requiredMinutes = 480,
): DailyBalance[] {
  const balances: DailyBalance[] = []
  const lunchDeductions = getDailyLunchDeductions(sessions, workDays)

  /*
   * Sesbíráme všechny datumy, které mají buď pracovní session,
   * nebo nějaký záznam volna.
   */
  const dates = new Set<string>()

  for (const session of sessions) {
    const date = formatInTimeZone(
      new Date(session.started_at),
      APP_TIMEZONE,
      'yyyy-MM-dd',
    )

    dates.add(date)
  }

  for (const workDay of workDays) {
    dates.add(workDay.date)
  }

  /*
   * Každý den zpracujeme pouze jednou.
   */
  for (const date of dates) {
    const daySessions = sessions.filter((session) => {
      const sessionDate = formatInTimeZone(
        new Date(session.started_at),
        APP_TIMEZONE,
        'yyyy-MM-dd',
      )

      return sessionDate === date
    })

    const dayWorkDays = workDays.filter(
      (day) => day.date === date,
    )

    /*
     * Pokud je v jednom dni více pracovních sessions,
     * jejich odpracovaný čas se sečte.
     */
    const workedMinutes = daySessions.reduce(
      (total, session) => {
        return (
          total +
          calculateSessionWorkedMinutes(
            session,
            lunchDeductions.get(session) ?? null,
            workDays,
          )
        )
      },
      0,
    )

    /*
     * Dovolená, sick day a další uznané volno.
     */
    const creditedMinutes = dayWorkDays
      .filter((day) => day.type !== 'comp_time')
      .reduce(
        (total, day) =>
          total + (day.type === 'doctor' && day.doctor_from && day.doctor_to
            ? splitDoctorVisit(day.doctor_from.slice(0, 5), day.doctor_to.slice(0, 5)).paidMinutes
            : day.duration_minutes),
        0,
      )

    /*
     * Náhradní volno.
     */
    const compTimeMinutes = dayWorkDays
      .filter((day) => day.type === 'comp_time')
      .reduce(
        (total, day) =>
          total + day.duration_minutes,
        0,
      )
      + dayWorkDays.reduce((total, day) => total + (
        day.type === 'doctor' && day.doctor_from && day.doctor_to
          ? splitDoctorVisit(day.doctor_from.slice(0, 5), day.doctor_to.slice(0, 5)).overtimeMinutes : 0
      ), 0)

    const balanceMinutes = calculateDailyBalance(
      workedMinutes,
      creditedMinutes,
      compTimeMinutes,
      requiredMinutes,
    )

    const overtimeChangeMinutes =
      calculateOvertimeChange(
        workedMinutes,
        creditedMinutes,
        compTimeMinutes,
        requiredMinutes,
      )

    balances.push({
      date,
      workedMinutes,
      creditedMinutes,
      compTimeMinutes,
      balanceMinutes,
      overtimeChangeMinutes,
    })
  }

  return balances
}

export function calculateRunningOvertime(
  dailyBalances: DailyBalance[],
): number {
  const sortedBalances = [...dailyBalances].sort(
    (a, b) => a.date.localeCompare(b.date),
  )

  return sortedBalances.reduce(
    (total, day) =>
      total + day.overtimeChangeMinutes,
    0,
  )
}

export function calculateAnnualOvertime(
  dailyBalances: DailyBalance[], now: Date,
  year = formatInTimeZone(now, APP_TIMEZONE, 'yyyy'),
): number {
  const today = formatInTimeZone(now, APP_TIMEZONE, 'yyyy-MM-dd')
  return calculateRunningOvertime(dailyBalances.filter(
    (day) => day.date.slice(0, 4) === year && day.date <= today,
  ))
}

/**
 * Naformátuje počet minut jako délku.
 *
 * addSign = true:
 *   30  -> +30 min
 *   -30 -> -30 min
 *
 * addSign = false:
 *   30  -> 30 min
 */
export function formatDuration(
  minutes: number,
  addSign = true,
): string {
  const sign = addSign
    ? minutes > 0
      ? '+'
      : minutes < 0
        ? '-'
        : ''
    : ''

  const absoluteMinutes = Math.abs(minutes)

  const hours = Math.floor(
    absoluteMinutes / 60,
  )

  const remainingMinutes =
    absoluteMinutes % 60

  if (hours === 0) {
    return `${sign}${remainingMinutes} min`
  }

  if (remainingMinutes === 0) {
    return `${sign}${hours} h`
  }

  return `${sign}${hours} h ${remainingMinutes} min`
}