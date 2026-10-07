const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'))

interface TimeInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
}

/**
 * 24hodinový výběr času (HH:mm). Nativní input type="time" přebírá
 * formát z jazyka prohlížeče a může zobrazovat AM/PM.
 */
export function TimeInput({ id, value, onChange, disabled, autoFocus }: TimeInputProps) {
  const [hours = '00', minutes = '00'] = value.split(':')

  return (
    <div className="time-input" role="group">
      <select
        id={id}
        aria-label="Hodiny"
        value={hours}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => onChange(`${event.target.value}:${minutes}`)}
      >
        {HOURS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select
        aria-label="Minuty"
        value={minutes}
        disabled={disabled}
        onChange={(event) => onChange(`${hours}:${event.target.value}`)}
      >
        {MINUTES.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
      </select>
    </div>
  )
}

interface DateTimeInputProps {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/** Datum + 24hodinový čas, hodnota ve formátu yyyy-MM-ddTHH:mm. */
export function DateTimeInput({ id, value, onChange, disabled }: DateTimeInputProps) {
  const [date = '', time = '00:00'] = value.split('T')

  return (
    <div className="date-time-input">
      <input
        id={id}
        type="date"
        aria-label="Datum"
        value={date}
        disabled={disabled}
        required
        onChange={(event) => onChange(`${event.target.value}T${time}`)}
      />
      <TimeInput
        id={`${id}-time`}
        value={time}
        disabled={disabled}
        onChange={(nextTime) => onChange(`${date}T${nextTime}`)}
      />
    </div>
  )
}
