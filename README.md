# Attendance App

A web app for tracking employee attendance and leave. Users can record work
sessions, manage leave, review their attendance in a calendar, and view work
statistics. Admins can manage users and registration invitations. Monthly and
yearly statistics can be exported to Excel.

## Built with

- React and TypeScript
- Vite
- Supabase for authentication and data storage
- date-fns for date and time handling
- ExcelJS for spreadsheet exports

## Development

Requires Node.js 22.18 or newer.

1. Install dependencies:

   ```sh
   npm install
   ```

2. Add the Supabase project URL and publishable key to `.env.local`:

   ```sh
   VITE_SUPABASE_URL=your-supabase-project-url
   VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
   ```

3. Start the development server:

   ```sh
   npm run dev
   ```

See [Supabase setup](./supabase/README.md) for database migrations and deployment
requirements.

## Overtime account

The overtime account uses the current calendar year (the selected year in admin
statistics). Today's unfinished daily requirement is not posted as a deficit
while the day can still be completed, including between separate work sessions.
Once today's work and credited leave fulfil the daily requirement, the calculated
overtime change is included immediately. Otherwise the day's change is posted
after midnight in Europe/Prague. Past-day deficits remain included.

A paid doctor visit from 10:15 to 13:00 does not reduce overtime merely because
the work session is still open. Its 165 minutes remain visible in daily/monthly
fulfilment and exports, separately from the posted overtime account. Doctor time
outside 08:30–14:00 still consumes overtime when the day's change is posted.

## Checks

```sh
npm run build
npm run lint
npm test
```