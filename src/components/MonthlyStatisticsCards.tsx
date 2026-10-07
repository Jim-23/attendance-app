import { formatDuration } from '../lib/attendance'
import type { MonthlyStatistics } from '../lib/monthly'

function MonthlyStatisticsCards({ statistics }: { statistics: MonthlyStatistics }) {
  const progress = statistics.fundMinutes > 0
    ? Math.min(100, statistics.fulfilledMinutes / statistics.fundMinutes * 100)
    : 100
  const hasPlans = statistics.plannedWorkMinutes !== 0 || statistics.plannedLeaveMinutes > 0 ||
    statistics.plannedHolidayMinutes > 0
  const excessMinutes = Math.max(0, statistics.balanceMinutes)

  return (
    <div className="monthly-overview">
      <section className="monthly-progress-card" aria-label="Plnění měsíčního fondu">
        <div className="monthly-progress-heading">
          <div>
            <span className="stat-label">Splněno z měsíčního fondu</span>
            <p className="monthly-progress-total">
              <strong>{formatDuration(statistics.fulfilledMinutes, false)}</strong>
              <span>z {formatDuration(statistics.fundMinutes, false)}</span>
            </p>
          </div>
          <div className="monthly-remaining">
            <span className="stat-label">
              {excessMinutes > 0 ? 'Nad měsíční fond' : statistics.remainingMinutes === 0 ? 'Fond splněn' : 'Zbývá splnit'}
            </span>
            <strong className={statistics.remainingMinutes === 0 ? 'positive' : undefined}>
              {formatDuration(excessMinutes || statistics.remainingMinutes, false)}
            </strong>
          </div>
        </div>
        <progress
          className="monthly-progress-bar"
          max={100}
          value={progress}
          aria-label="Splnění měsíčního fondu"
          aria-valuetext={`${formatDuration(statistics.fulfilledMinutes, false)} z ${formatDuration(statistics.fundMinutes, false)}`}
        />
        <dl className="monthly-breakdown">
          <div><dt>Dokončená práce</dt><dd>{formatDuration(statistics.workedMinutes, false)}</dd></div>
          <div><dt>Započtené volno</dt><dd>{formatDuration(statistics.creditedLeaveMinutes, false)}</dd></div>
          <div><dt>Placené svátky</dt><dd>{formatDuration(statistics.creditedHolidayMinutes, false)}</dd></div>
        </dl>
        <p className="monthly-note">
          Práce, volno a placené svátky do dneška · čisté hodiny bez oběda.
          Všední dny: {statistics.workingDays}, z toho svátky: {statistics.holidayDays}.
        </p>
      </section>

      <section className="monthly-plans" aria-label="Výhled s plánovanými hodinami">
        <div className="monthly-plans-heading">
          <h3>Výhled s plány</h3>
          <span>Ještě není splněno</span>
        </div>
        {hasPlans ? (
          <>
            <dl className="monthly-breakdown">
              <div><dt>Plánovaná práce</dt><dd>{formatDuration(statistics.plannedWorkMinutes, false)}</dd></div>
              <div><dt>Plánované volno</dt><dd>{formatDuration(statistics.plannedLeaveMinutes, false)}</dd></div>
              <div><dt>Nadcházející svátky</dt><dd>{formatDuration(statistics.plannedHolidayMinutes, false)}</dd></div>
            </dl>
            <p className="monthly-projection">
              Po splnění plánů: <strong>{formatDuration(statistics.projectedMinutes, false)}</strong>
              {' · '}
              {statistics.projectedRemainingMinutes > 0
                ? `zbývá ${formatDuration(statistics.projectedRemainingMinutes, false)}`
                : 'měsíční fond bude splněn'}
            </p>
          </>
        ) : (
          <p className="monthly-note">Bez plánovaného odchodu, budoucího volna a svátků v tomto měsíci.</p>
        )}
      </section>

      <details className="monthly-explanation">
        <summary>Jak se fond a hodiny počítají?</summary>
        <p>
          Fond zahrnuje všechny pracovní dny včetně svátků.
          Svátky se automaticky započítají jako placené hodiny bez oběda.
          Volno se započítává do splnění: celý den 8 h, půlden 4 h a náhradní volno podle délky, nejvýše do denní povinnosti.
        </p>
        <p>
          Práce zahrnuje pouze ukončenou docházku po zaokrouhlení a odečtení oběda.
          Plány zahrnují docházku s plánovaným odchodem, budoucí volno a nadcházející svátky.
          Přesčasový účet je samostatný.
        </p>
      </details>
    </div>
  )
}

export default MonthlyStatisticsCards
