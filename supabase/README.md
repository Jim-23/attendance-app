# Supabase setup

This migration targets the existing `profiles`, `work_sessions`, and `work_days`
tables provided in the schema export, including the `on_auth_user_created`
AFTER INSERT trigger on `auth.users`. Apply it **once** to that project before
deploying the frontend. Back up the database first. No live database changes
are performed by the app build.

## Deployment

1. Review and apply
   [202610020001_invitations_and_admin.sql](./migrations/202610020001_invitations_and_admin.sql)
   through the Supabase SQL editor or your migration runner. The file is
   transactional and preserves existing profiles and attendance. Then apply
   [202610060001_one_lunch_per_day.sql](./migrations/202610060001_one_lunch_per_day.sql),
   which allows at most one recorded lunch per user and Prague day (by arrival
   date) and requires the lunch to lie within its session. Existing duplicate
   lunches are kept; the app counts only the first one of the day. Finally apply
   [202610070001_calendar_editing.sql](./migrations/202610070001_calendar_editing.sql),
   which lets users delete their own work sessions and rejects overlapping
   sessions or a departure before arrival (an open session counts as running
   indefinitely). Existing overlaps are kept until those sessions are changed.
   Then apply
   [202610070002_planned_departures.sql](./migrations/202610070002_planned_departures.sql).
   It adds optional planned departure times and database functions to finish due
   sessions. **Before deploying the frontend**, enable **Supabase Cron**
   (`pg_cron`) in the Supabase dashboard and run
   [schedule_planned_departures.sql](./schedule_planned_departures.sql) as the
   database owner. This schedules completion every minute, independent of any
   browser. `ended_at` is the exact planned timestamp, not the job execution
   time. A manually recorded departure clears the plan.

   Verify the job exists and is active:
   ```sql
   select jobid, jobname, schedule, active
   from cron.job where jobname = 'attendance-planned-departures';
   ```
   Test an arrival with a planned departure a few minutes ahead, close the app,
   and verify that `ended_at` is populated after the next scheduled run. Check
   job failures in Supabase Cron or `cron.job_run_details`; a failing/disabled
   job means unattended completion will not work. Opening the app also finishes
   the logged-in user's due plan, but does not replace Cron.
2. If no existing administrator is present, promote a trusted **existing**
   account through the SQL editor as database owner:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (
     select id from auth.users where lower(email) = lower('REPLACE_WITH_TRUSTED_EMAIL')
   );
   ```

   Verify exactly one intended profile was updated. Do not enable public signup
   on an unpatched database to create this account. Existing users remain able
   to log in.
3. Enable email/password signups in Supabase Auth. Configure email confirmation,
   site URL/redirect URLs, SMTP, and signup rate limits for your deployment.
   Enable email confirmation for production. Registration consumes an invitation
   **when the account is created**, not when email confirmation is completed.
   Unconfirmed accounts require confirmation-email resend/support via Supabase;
   issuing a second key is not a substitute for confirming an existing account.
4. Log in as the administrator, choose **Menu → Administrace**, and create an
   invitation. Copy the displayed key and send it privately to the intended
   recipient. Only its SHA-256 hash is retained in the invitation table.
5. The recipient chooses **Mám registrační klíč**, provides name, email, password,
   and the key, then confirms email if required.
6. Build the frontend with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` set to your project's values. For local
   development use a git-ignored `.env.local`; production builds need the same
   variables supplied by your hosting/build environment. The Supabase URL and
   publishable key are embedded at build time, not read from the server later.
   A build without them has no usable application UI. Test builds using dummy
   values must not be deployed.

The frontend only uses the publishable Supabase key. Never put service-role
credentials or invitation keys into Vite environment variables or commit them.

## Enforcement

- The existing auth profile-creation trigger now validates and atomically
  consumes invitations. Direct Auth signup without a valid key is rejected,
  including requests that bypass the UI. Newly registered profiles always get
  `user`; user metadata cannot assign an admin role.
- Invitations can be unbound or email-bound, expire in 1–30 days, and can be
  revoked. Raw keys are returned only at creation and removed from persisted
  auth metadata. OAuth/phone-only account creation also requires an invitation
  and email under this policy; this app supports email/password only.
- Database role checks guard every admin RPC. Existing own-record RLS remains;
  admin SELECT policies permit inspection of attendance. Admins do not gain
  editing access to other users' attendance.
- Profile UPDATE grants allow authenticated clients to edit `full_name` only.
  Role updates go through the admin-only RPC, which serializes role changes and
  prevents removing the last admin. Provisioning via trusted SQL remains possible.
- Company-wide vacation is a 480-minute weekday record. Both vacation types
  share the 20-day annual allowance. The database checks the 8-hour daily cap,
  annual vacation/sick-day limits, and serializes changes per user.
- Legacy NULL leave durations are counted as full days for allowance checks.
  New inserts/updates must specify duration. Review any existing over-limit or
  NULL-duration data before deployment; it is not silently rewritten.

## Validation in a disposable database

**Never run the fixture in your live Supabase database.** It creates simplified
auth objects, roles, and test-only accounts. Use a new isolated PostgreSQL 17
database, then apply these files in order with `psql -v ON_ERROR_STOP=1`:

1. [tests/fixture.sql](./tests/fixture.sql)
2. [migrations/202610020001_invitations_and_admin.sql](./migrations/202610020001_invitations_and_admin.sql)
3. [migrations/202610060001_one_lunch_per_day.sql](./migrations/202610060001_one_lunch_per_day.sql)
4. [migrations/202610070001_calendar_editing.sql](./migrations/202610070001_calendar_editing.sql)
5. [migrations/202610070002_planned_departures.sql](./migrations/202610070002_planned_departures.sql)
6. [tests/invitations_and_admin.sql](./tests/invitations_and_admin.sql)
7. [tests/one_lunch_per_day.sql](./tests/one_lunch_per_day.sql)
8. [tests/calendar_editing.sql](./tests/calendar_editing.sql)
9. [tests/planned_departures.sql](./tests/planned_departures.sql)

The regression suite checks invalid/missing/reused/expired/revoked invitations,
email binding, ignored role metadata, role and RLS restrictions, last-admin
protection, company-wide leave dates/durations, shared annual allowance, one
lunch per day, session overlap prevention, the work session delete policy,
planned departure validation, early manual completion, exact automatic timestamps,
and isolation of the user-scoped completion RPC. The fixture does not install
pg_cron; verify scheduling separately in Supabase as described above.
This verifies database logic; production email delivery and Supabase Auth
configuration still require deployment smoke tests.
