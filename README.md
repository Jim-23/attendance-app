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

## Checks

```sh
npm run build
npm run lint
npm test
```