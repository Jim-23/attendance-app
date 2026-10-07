const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, '0'),
  label: new Intl.DateTimeFormat('cs-CZ', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, index, 1))),
}))

interface MonthInputProps {
  id: string
  value: string
  onChange: (value: string) => void
}

function MonthInput({ id, value, onChange }: MonthInputProps) {
  const [year, month] = value.split('-')

  return (
    <div className="month-input" role="group" aria-label="Měsíc a rok">
      <select
        id={id}
        aria-label="Měsíc"
        value={month}
        onChange={(event) => onChange(`${year}-${event.target.value}`)}
      >
        {MONTHS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <button
        type="button"
        className="button button-secondary button-small"
        aria-label="Předchozí rok"
        disabled={Number(year) <= 1}
        onClick={() => onChange(`${String(Number(year) - 1).padStart(4, '0')}-${month}`)}
      >
        &lt;
      </button>
      <span className="month-input-year" aria-live="polite">{year}</span>
      <button
        type="button"
        className="button button-secondary button-small"
        aria-label="Následující rok"
        disabled={Number(year) >= 9999}
        onClick={() => onChange(`${String(Number(year) + 1).padStart(4, '0')}-${month}`)}
      >
        &gt;
      </button>
    </div>
  )
}

export default MonthInput
