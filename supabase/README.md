# Supabase backend setup

The school portal Supabase project is `mmpshmsabvalibtkakna` (Central EU, Frankfurt). The project URL and public publishable key are configured in `../supabase-config.js`. The publishable key may be used by the browser; never put a database password, `service_role`, or secret key in browser files.

## Database migration

`migrations/001_school_portal.sql` creates the school tables and enables row-level security (RLS). It covers profiles, school settings, classes, attendance, grades, online exams/questions/answer keys/submissions, payments, announcements, and private messages. Exam answer keys are kept separate and students submit answers to a database function that scores them server-side.

The initial migration has been applied to the Supabase project. The policies are the access rules: students can see their own student records, teachers can work with assigned classes, registrars manage enrollment/payments/transcripts, and administrators manage school settings. RLS should remain enabled.

## First administrator bootstrap

Create the first school account from the website's Student enrollment tab using the administrator's school email. Confirm the email if the project requests it. The auth trigger creates its profile as a pending student. In Supabase SQL Editor, promote that one profile (replace the email with the actual administrator account):

```sql
update public.profiles
set role = 'admin', status = 'Active'
where email = 'ADMIN_EMAIL_HERE';
```

Only run this bootstrap once for the first trusted administrator. Additional staff accounts are provisioned through the server-side Edge Function in `functions/create-account/index.ts`; this function must be deployed before Add staff or direct student account creation can work. Its service-role key stays in Supabase Function secrets and is never placed in browser files.

## Current status

The landing page now signs students up through Supabase Auth, and the portal adapter loads and saves school records through Supabase with the configured RLS policies. First-admin activation and deployment of the server-side `create-account` function are still required for staff provisioning. Card processing still requires a payment provider; the portal records payment requests only. Do not enter real student data until the first admin is activated and the Edge Function is deployed.

## Finish local setup

1. In Supabase **Authentication → URL Configuration**, add `http://localhost:5500` as a redirect URL for local preview (and add the production domain before launch).
2. Create the first administrator account in the portal enrollment form, confirm its email, then run the one-time promotion SQL above.
3. Install the official Supabase CLI, open a terminal in this project folder, then run:

   ```powershell
   supabase login
   supabase link --project-ref mmpshmsabvalibtkakna
   supabase functions deploy create-account
   ```

   The function uses Supabase's server-side environment secrets. Never paste a secret/service-role key into `supabase-config.js`.
4. In VS Code, run the site with Live Server at `http://localhost:5500`. The website uses the Supabase JS client and needs a local web server; opening `index.html` as a `file://` page is not the supported sign-in setup.
