# Madda Walabu Academy portal

This local setup serves the website and its Node.js API from one address, with MongoDB Server storing accounts and school records.

## Start the portal

MongoDB Server is expected at `mongodb://127.0.0.1:27017`; the app creates the `madda_walabu_school` database and collections automatically.

1. Open `C:\Users\mypc\Desktop\school` in VS Code.
2. Open **Terminal → New Terminal**.
3. Run `npm start` (or `npm run dev` while editing).
4. Visit **http://localhost:3000**.

If PowerShell says `npm` is not recognized, run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' start
```

The first server run creates a private local signing secret in `.session-secret`. It is ignored by Git. For another computer or a production server, configure the MongoDB connection and `SESSION_SECRET` in `.env` using `.env.example` as a template.

## First administrator

In a second terminal, run `npm run create-admin`. Enter the administrator’s name, email, and a strong password when prompted. Then sign in on the website. New public student enrollment requests start as **Pending** until a school administrator or registrar approves them.

## What is connected

- Supabase Auth/database calls are no longer loaded by the website. The old migration files remain under `supabase/` as a record of the previous setup.
- Node.js handles sign-in, role checks, enrollment, class lists, attendance, grades, exams, fee records, announcements, and messages.
- MongoDB stores account profiles and school records on the running MongoDB Server service.
- Exam answers are scored by the server; the correct answers are not returned to student accounts.
- The current fee screens record payment requests and confirmations. Charging cards or mobile money requires a payment provider.

This is a local development setup. Before opening it to the public internet, deploy behind HTTPS, set a production MongoDB connection and secret, configure backups, and review the school’s access and privacy requirements.

## Live chat, complaints, and email alerts

- Live school chat updates between active portal sessions in real time. Public messages are shared with the school community; authenticated direct-recipient messaging is supported by the API.
- Students and staff can submit private complaints. Administrators and registrars can reply and update the status. Students and staff see only their own complaint threads.
- Reply email alerts are sent when SMTP settings are added to `.env` using the `MAIL_*` examples in `.env.example`. Without those settings, replies are still saved and shown in the portal, with an on-screen notice that email delivery is not configured.
- The landing page and common dashboard labels support English, Amharic, and Afaan Oromoo. Some teacher-created content and detailed school records remain in the language they were entered.

After adding or changing `.env`, restart the server for the mail settings to take effect.

## Rename the school portal

Sign in as an administrator, open **School settings**, change **School name**, and save. The name updates in the page title, public header, footer, dashboard, and school branding after saving.
