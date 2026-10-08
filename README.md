# Attendance app

## Dashboard and calendar

Annual vacation and sick-day allowances use days as the primary unit (one day
is eight hours), with hours shown in smaller parentheses, including remaining
allowances. Admin annual totals use the same format.
Today's controls and metrics are grouped in one responsive panel. The main
dashboard always includes the cumulative overtime account from completed
attendance and leave through today, explicitly excluding the running session.
Compensatory leave is deducted from this account; it is not the monthly Fond balance.

The dashboard shows today's date and attendance totals in `Europe/Prague`,
followed by an editable monthly calendar. Use the header menu to switch to
History (including session corrections), Leave, or Statistics; **Odhlásit** is
at the bottom of the menu. Times are always entered in 24-hour format.

Clicking **Příchod** or **Odchod** opens a 24-hour time picker (today's date)
prefilled with the current time, so the real arrival or departure time can be recorded
right away. If the running session started on an earlier day (a forgotten
departure), the dashboard says so and the **Odchod** picker also offers the
day of departure, defaulting to the arrival day with arrival + 8 h 30 min
(at most 23:45); **Začít oběd** is hidden for such a session. Changing the date of a completed session is done in History. Future times are rejected, an arrival cannot fall inside an
already recorded session, and a departure must come after the arrival and any
recorded lunch start.

When recording **Příchod**, users can optionally enable **Naplánovat automatický
odchod** and select a departure time later today. The option is off by default.
The session stays open until that time; an earlier manual **Odchod** overrides
the plan. Supabase Cron completes due sessions every minute using the exact
planned timestamp, even while the app is closed. The open app refreshes planned
sessions every 30 seconds and on window focus. Normal rounding and lunch rules
apply after completion. This requires the migration and Cron setup described in
[Supabase setup](./supabase/README.md).

During today's open session, **Do konce směny** shows the wall-clock time until
the daily requirement is fulfilled, accounting for arrival/departure rounding,
completed sessions, leave, and the single daily lunch deduction. Before arrival,
**Zbývá odpracovat** explicitly shows net work time excluding lunch.
**Do plánovaného odchodu** is a separate countdown to the selected automatic
departure; it can be earlier or later than fulfilling the daily requirement.

The calendar displays recorded sessions and leave, plus Czech public holidays
(including Good Friday and Easter Monday). These holiday markers do not create
leave records, but automatically credit paid weekday holiday hours toward the monthly Fond.
Navigate between months or use **Dnes** to return to the current month.
On small screens the calendar scrolls horizontally.

Click a day (or its date button) to open the day panel. There you can add,
edit, or delete that day's work sessions (time only, on that date) and add or
delete leave. Sessions cannot be added for future days, leave can only be
added on weekdays, and a running session can only have its arrival changed.
Sessions crossing midnight are edited in History. Overlapping sessions are
rejected both in the app and in the database.
Holiday dates follow the [Czech National Bank's public holiday list](https://www.cnb.cz/en/public/media-service/schedules-and-other-info/bank-holidays-in-the-czech-republic/),
with movable Easter dates calculated for the displayed year.

Run calendar date and holiday regression tests with `npm run test:calendar`
(Node.js 22.18+).

Completed attendance is calculated using the existing 15-minute rounding and
automatic 30-minute lunch rule. Only one lunch is deducted per day (by arrival
date): a recorded lunch takes precedence, otherwise the first completed session
longer than 5 hours gets the automatic lunch. **Začít oběd** is hidden once the
day already has a lunch. Calendar session times show the recorded times;
session durations show the calculated worked time.

## Monthly statistics

User and admin Statistics offer **Export měsíce (Excel)** and **Export roku
(Excel)** for the selected month/year as `.xlsx` files. Each file contains one daily summary for
every calendar day (including weekends, empty days, and future dates), not
session detail rows. Columns are **Den, Datum, Plán, Započteno, Oběd,
Bilance (+/−), Počátek, Konec, Poznámka, Stav**.

Times/dates use Europe/Prague and durations use `H:mm`. Annual workbooks have
one Czech-named sheet per month; every workbook includes a **Legenda** sheet.
Headers are frozen and columns are filterable. Yellow marks holidays, blue
marks leave, green marks hours above the daily plan, and red marks missing
hours on past dates. Balance cells remain separately highlighted on leave
or holiday rows so both conditions are visible. Orange marks unfinished
attendance or today's ongoing shortfall; future dates use muted text and are
not marked as missed hours. Czech **Stav** labels identify every condition
without relying only on colours. Extra daily hours are not the cumulative
overtime account. Notes are stored as text, never executed as Excel formulas.

ExcelJS is loaded only when exporting. Its transitive `uuid` dependency is
overridden to the patched 11.1.1+ CommonJS-compatible version; ExcelJS uses
only the compatible `v4` API.
Plan is the daily net requirement (including paid weekday holidays); credited
hours match monthly fulfilment. Future leave/holidays and unclosed sessions
remain uncredited and are noted; future daily balances are blank. The lunch
column contains only the once-per-day deducted lunch, not gaps between sessions.
Start/end show the earliest actual arrival and latest actual departure of
completed sessions, before rounding; overnight departures include their date.
Multiple sessions are aggregated into the same daily row and noted. Annual
exports contain all 365 or 366 dates. Export is disabled until data is loaded.

**Statistiky** has a month selector and shows:

Month names are explicitly Czech (leden through prosinec), independent of the
browser language, in both user and admin statistics. Arrow buttons change the year.

The overview groups these figures into a single fulfilment/progress summary
(completed work + credited leave + paid holidays), followed by a visually separate **Výhled
s plány** panel. Calculation details are expandable rather than displayed
on every metric. Progress is capped visually at 100%; actual totals and any
hours above the monthly Fond remain visible.

- **Měsíční fond:** 8 net hours per weekday, including public holidays.
  **Placené svátky** automatically credits Czech weekday public holidays
  (including Easter) and additional `holiday` records through today, without
  lunch deductions. Future holidays appear as **Nadcházející svátky** in the
  projection. Weekend holidays add no hours, and a holiday is never credited
  twice even if there is also a manual holiday or vacation record on that date.
- **Dokončená práce:** only closed sessions, with the normal rounding and daily
  lunch deduction. Sessions are assigned to their Prague arrival date, as in
  History. Weekend/holiday work still counts as work.
- **Započtené volno:** vacation (8/4 h), company-wide vacation, sick day, and
  compensatory leave at their recorded durations on working days through today.
  Leave on a weekend or holiday cannot fulfil Fond a second time. Leave credits
  are capped at the daily requirement for each date.
- **Splněno z fondu** and **Zbývá splnit:** completed work plus credited leave and paid holidays
  versus the full Fond. Vacation does not reduce the baseline Fond.
- **Plánovaná práce**, **Plánované volno**, and **Celkem po splnění plánů:**
  projections using open sessions with planned departures, future leave, and upcoming holidays,
  kept separate from already fulfilled hours. An unplanned open session is
  not counted as finished or projected work.

Editing, adding, or deleting attendance/leave recalculates these figures from
the loaded records; there is no persisted monthly total to become stale.
Admins use the same calculation with each user's configured daily requirement.
The existing cumulative overtime account remains a separate calculation and is
not the monthly Fond balance.

## Registration, roles and company-wide vacation

**Apply the backend migration before deploying this version.** See
[Supabase setup](./supabase/README.md) for deployment, first-admin provisioning,
and database regression checks.

Registration requires a single-use admin-generated invitation key. An invitation
can be tied to one email and expires after 1–30 days. Existing accounts keep
their roles. Admins use **Menu → Administrace** to edit names and roles,
view user statistics, and create/revoke invitations. Account suspension and
deletion are not included.

**Celozávodní dovolená** uses the existing `mandatory_vacation` database value.
Users explicitly add one weekday (8 hours), not a date range. It credits that
day and shares the normal 20-day annual vacation allowance, including planned
leave. Admin and user statistics both include it.

Run all application regression tests with `npm test` (Node.js 22.18+).

## Development template

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
