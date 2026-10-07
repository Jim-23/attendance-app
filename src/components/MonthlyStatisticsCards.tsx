import { formatDuration } from '../lib/attendance'
import type { MonthlyStatistics } from '../lib/monthly'

function MonthlyStatisticsCards({ statistics }: { statistics: MonthlyStatistics }) {
  const cards = [
    {
      label: 'Měsíční fond',
      minutes: statistics.fundMinutes,
      description: `Pracovní dny: ${statistics.workingDays} · svátky ve všední den: ${statistics.holidayDays}. Bez oběda.`,
    },
    {
      label: 'Dokončená práce',
      minutes: statistics.workedMinutes,
      description: 'Čistý čas pouze z ukončené docházky, po zaokrouhlení a odečtení oběda.',
    },
    {
      label: 'Započtené volno',
      minutes: statistics.creditedLeaveMinutes,
      description: 'Volno do dnešního dne včetně. Celý den 8 h, půlden 4 h, náhradní volno dle délky.',
    },
    {
      label: 'Splněno z fondu',
      minutes: statistics.fulfilledMinutes,
      description: 'Dokončená práce + započtené volno.',
    },
    {
      label: 'Zbývá splnit',
      minutes: statistics.remainingMinutes,
      description: 'Zbytek měsíčního fondu. Budoucí plány ještě nejsou splněné.',
    },
    {
      label: 'Plánovaná práce',
      minutes: statistics.plannedWorkMinutes,
      description: 'Očekávaný čistý čas otevřené docházky s plánovaným odchodem.',
    },
    {
      label: 'Plánované volno',
      minutes: statistics.plannedLeaveMinutes,
      description: 'Zadané volno na budoucí pracovní dny tohoto měsíce.',
    },
    {
      label: 'Celkem po splnění plánů',
      minutes: statistics.projectedMinutes,
      description: `Práce a volno včetně plánů. Poté zbývá ${formatDuration(statistics.projectedRemainingMinutes, false)}.`,
    },
  ]

  return (
    <div className="stats-grid">
      {cards.map((card) => (
        <div className="stat-card" key={card.label}>
          <span className="stat-label">{card.label}</span>
          <strong className="stat-value">{formatDuration(card.minutes, false)}</strong>
          <span className="stat-description">{card.description}</span>
        </div>
      ))}
    </div>
  )
}

export default MonthlyStatisticsCards
