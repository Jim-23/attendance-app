# Attendance app

## Dashboard and calendar

The dashboard shows today's date and attendance totals in `Europe/Prague`,
followed by a read-only monthly calendar. Use the header menu to switch to
History (including session corrections), Leave, or Statistics.

Clicking **Příchod** or **Odchod** opens a date/time field prefilled with the
current time, so a forgotten arrival or departure can be recorded with the real
time right away. Future times are rejected, an arrival cannot fall inside an
already recorded session, and a departure must come after the arrival and any
recorded lunch start.

The calendar displays recorded sessions and leave, plus Czech public holidays
(including Good Friday and Easter Monday). These holiday markers are
informational only: they do not create leave records or change attendance
balances. Navigate between months or use **Dnes** to return to the current month.
On small screens the calendar scrolls horizontally.
Holiday dates follow the [Czech National Bank's public holiday list](https://www.cnb.cz/en/public/media-service/schedules-and-other-info/bank-holidays-in-the-czech-republic/),
with movable Easter dates calculated for the displayed year.

Run calendar date and holiday regression tests with `npm run test:calendar`
(Node.js 22.18+).

Completed attendance is calculated using the existing 15-minute rounding and
automatic 30-minute lunch rule. Calendar session times show the recorded times;
session durations show the calculated worked time.

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
