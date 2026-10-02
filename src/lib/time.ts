import {
  formatInTimeZone,
  fromZonedTime,
} from 'date-fns-tz'

export const APP_TIMEZONE = 'Europe/Prague'

export function formatTime(timestamp: string): string {
  return formatInTimeZone(
    new Date(timestamp),
    APP_TIMEZONE,
    'HH:mm',
  )
}

export function formatDate(timestamp: string): string {
  return formatInTimeZone(
    new Date(timestamp),
    APP_TIMEZONE,
    'dd. MM. yyyy',
  )
}

export function formatDateTimeLocal(timestamp: string): string {
  return formatInTimeZone(
    new Date(timestamp),
    APP_TIMEZONE,
    "yyyy-MM-dd'T'HH:mm",
  )
}

export function parseDateTimeLocal(value: string): Date {
  return fromZonedTime(value, APP_TIMEZONE)
}

export function getStartOfTodayUtc(): string {
  const today = formatInTimeZone(
    new Date(),
    APP_TIMEZONE,
    'yyyy-MM-dd',
  )

  return fromZonedTime(
    `${today} 00:00:00`,
    APP_TIMEZONE,
  ).toISOString()
}

export function getStartOfCurrentMonthUtc(): string {
  const currentMonth = formatInTimeZone(
    new Date(),
    APP_TIMEZONE,
    'yyyy-MM',
  )

  return fromZonedTime(
    `${currentMonth}-01 00:00:00`,
    APP_TIMEZONE,
  ).toISOString()
}