import {
  formatInTimeZone,
  fromZonedTime,
} from 'date-fns-tz'

const APP_TIMEZONE = 'Europe/Prague'

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

  return fromZonedTime(roundedLocalTime, APP_TIMEZONE)
}

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

  return fromZonedTime(roundedLocalTime, APP_TIMEZONE)
}

export function calculateWorkedMinutes(
  arrival: Date,
  departure: Date,
  hasLunch: boolean,
): number {
  const roundedArrival = roundArrival(arrival)
  const roundedDeparture = roundDeparture(departure)

  const totalMinutes =
    (roundedDeparture.getTime() - roundedArrival.getTime()) /
    (1000 * 60)

  const lunchMinutes = hasLunch ? 30 : 0

  return totalMinutes - lunchMinutes
}

export function calculateBalanceMinutes(
  workedMinutes: number,
  requiredMinutes = 480,
): number {
  return workedMinutes - requiredMinutes
}

export function formatDuration(minutes: number): string {
  const sign = minutes > 0 ? '+' : minutes < 0 ? '-' : ''
  const absoluteMinutes = Math.abs(minutes)

  const hours = Math.floor(absoluteMinutes / 60)
  const remainingMinutes = absoluteMinutes % 60

  if (hours === 0) {
    return `${sign}${remainingMinutes} min`
  }

  if (remainingMinutes === 0) {
    return `${sign}${hours} h`
  }

  return `${sign}${hours} h ${remainingMinutes} min`
}