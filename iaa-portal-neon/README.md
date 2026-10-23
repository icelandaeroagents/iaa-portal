# Iceland Aero Agents – Staff Portal

Internal portal for training, reports and station information.
Plain HTML, CSS and JavaScript with no build step, hosted on Vercel.
Sign-in and data are handled by Neon (Managed Better Auth + Data API).

```
iaa-portal/
├── public/                 ← the website (Vercel's Output Directory)
│   ├── index.html
│   ├── styles.css
│   ├── app.js              ← sign-in, roles, navigation, sections
│   ├── training.js         ← Training section: lessons, quizzes, certificates, records
│   ├── training-content.js ← the six modules and 60 quiz questions (edit to change content)
│   ├── reports.js          ← Reports section: report form, photos, follow-up
│   ├── briefings.js        ← Briefings section: latest issue, archive, Mark as read, upload
│   ├── briefing-convert.js ← reads issue number/date/topics from a briefing and makes the web version
│   ├── roster.js, roster-parse.js ← Roster: today on Home, full grid, Excel upload
│   ├── passes.js           ← Passes & certificates with expiry reminders
│   ├── requests.js         ← Requests: leave & availability; stock, equipment & defects
│   ├── config.js           ← your two Neon addresses go here
│   ├── logo.svg            ← IAA logo (transparent background, for the navy header)
│   ├── favicon.svg         ← browser tab icon
│   └── vendor/
│       ├── neon-js-0.7.0-beta.js   ← Neon's client library, bundled for the browser
│       ├── jspdf-2.5.1.umd.min.js  ← creates the certificate PDFs
│       ├── mammoth-1.9.1.browser.min.js ← turns uploaded Word briefings into web pages
│       └── xlsx-0.18.5.mini.min.js      ← reads the roster Excel file
├── database/
│   ├── schema.sql          ← run first in Neon's SQL Editor
│   ├── 02-invitations.sql  ← run second: invitations and personal emails
│   ├── 03-fix-profile-save.sql ← only for databases set up before 23 Oct 2026, 2 pm
│   ├── 04-training.sql     ← training attempts, sign-offs, certificates
│   ├── 05-import-old-training-records.sql ← records from the old training page
│   ├── 06-multiple-stations.sql ← people can belong to several stations
│   ├── 07-reports.sql      ← internal reports, photos, follow-up notes, email recipients
│   ├── 08-access-requests.sql ← people can request access; management approves
│   ├── 09-briefings.sql    ← weekly briefings and read confirmations
│   └── 10-staff-tools.sql  ← roster, passes & certificates, leave, service requests
├── api/
│   ├── report-notify.js    ← server function that emails each report to management
│   ├── access-notify.js    ← emails management about access requests, and people when approved
│   └── staff-notify.js     ← leave, urgent requests/vehicle defects, and pass expiry reminders
├── package.json            ← libraries for the server function (Vercel installs them)
├── tools/
│   └── build-neon-vendor.sh  ← only needed to upgrade the Neon library
├── vercel.json             ← security headers
└── README.md
```

## Set up Neon

1. In Vercel: **Storage → Create Database → Neon**, region **Frankfurt (eu-central-1)**, connect it to the iaa-portal project. Then open it in the Neon Console.
2. In the Neon Console, turn on **Auth**, then the **Data API** with **Use Neon Auth** ticked.
3. **SQL Editor** → paste all of `database/schema.sql` → **Run**. Then do the same with `database/02-invitations.sql`.
4. **Data API** page → **Refresh schema cache**.
5. **Settings → Better Auth**:
   - **Trusted domains:** add `https://portal.iaa.is` and your `.vercel.app` address.
   - **Application name:** IAA Staff Portal.
   - Make sure **Sign-up and Sign-in with Email** is on.
6. Copy the **Auth URL** (Settings → Better Auth → Project Info) and the **Data API URL** (Data API page) into `public/config.js`.

Never put the `postgresql://…` connection string (it contains a password) in any file in this repository. Vercel keeps it as an environment variable, which this site does not use.

## First sign-in

josh@iaa.is and admin@iaa.is are invited as Management by `02-invitations.sql`. Open the portal, enter one of those addresses, and type in the 6-digit code you're emailed. **People** and **Stations** appear straight away.

To make someone else management later, change their role on the People page.

## How access works

Neon Auth lets anyone create a login, so the portal adds its own gate. A profile, and with it any access at all, is only created for a **verified** email address that is either:

- **invited** on the People page (personal addresses are fine; the person joins with the role and station chosen in the invitation), or
- on an allowed company domain, currently `iaa.is` (joins as Staff with no station).

Everyone else sees "You don't have access yet". Inviting doesn't send an email: tell the person the portal address and which address to sign in with.

**When someone leaves:** untick their **Access** on the People page. With a personal email address, the address stays theirs, so this is the only thing that removes their access.

To allow another company domain:
`insert into public.allowed_email_domains (domain) values ('example.is');`

| Role | Can see |
|---|---|
| Staff | Home, Training, Reports, their own details |
| Station lead | As staff, plus the staff list for their own station (used by later sections) |
| Management | Everything, including People, Stations and the audit log |

Role, station and access can only be changed by management. The database enforces this, not just the page.

## Before rolling out to all staff

- **Email sending:** Neon's shared sender is for testing. Set up your own under **Settings → Better Auth → Email provider (Custom SMTP)**.
- **Localhost:** turn off **Allow Localhost** in Settings → Better Auth.
- **Phones:** test sign-in on an iPhone in Safari early, as Neon Auth is still in beta.
- **Fonts:** Barlow loads from Google Fonts. It can be self-hosted in `public/` if you prefer not to send staff browsers to Google.

## Upgrading the Neon library

Run `bash tools/build-neon-vendor.sh <version>` (needs Node.js), then update the file name in the script tag in `public/index.html`. Pick a version that has been out for at least two weeks.

## Training

- **Staff:** read each module, take its quiz (80% to pass), and see their own record and certificates under **Training**.
- **Management:** **Training → Records** shows everyone, the sign-off queue, CSV export, and a **Link old records** panel. Sign-off uses your name and job title from the Home page. Certificates can be revoked; revoked ones stay on record.
- **Station leads:** see records for staff at their own station.
- **Changing content:** edit `public/training-content.js` and upload it. Questions and lessons are copied unchanged from the old training page (SOP Manual v1.1).
- Quiz scoring runs in the browser, as on the old page, and the database checks that each score and pass mark add up. Management sign-off remains the confirmation step for each certificate.

## Reports

- **Staff** submit reports under **Reports → New report**, with up to 6 photos (shrunk in the browser before upload). Every active staff member can read every report. The reporter can withhold their name from other staff; management always sees it.
- **Management** sets status, owner and the "may need reporting to Samgöngustofa" flag, and adds private notes. The original report text can't be changed after it's submitted.
- **Email:** each report is emailed once to everyone in the `report_recipients` table (josh@, gtv@, hjalti@ and admin@iaa.is to start with), with photos attached. Vercel re-checks every 10 minutes for any report whose email didn't go out. To change recipients, see the end of `database/07-reports.sql`.

### Email settings (Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `DATABASE_URL` | Added automatically by the Neon integration. Check it's there. |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `admin@iaa.is` |
| `SMTP_PASS` | An app password for admin@iaa.is (Google account → Security → App passwords) |
| `SMTP_FROM` | `IAA Staff Portal <admin@iaa.is>` |
| `PORTAL_URL` | `https://portal.iaa.is` (or the vercel.app address until that works) |
| `CRON_SECRET` | Any long random text |

Redeploy after adding or changing these. Never put any of these values in the code.

## Access requests

Anyone with the portal link can sign in with their email and a code. If they're not invited and not on an allowed company domain, they can send a **Request access** form (name, stations, job, message). Management is emailed (same list as reports) and sees the request at the top of **People**, where they choose the role and stations and click **Approve** or **Decline**. Approved people are emailed and get in the next time they open the portal. Invitations work as before.

## Briefings

- **Publishing:** management opens **Briefings → Upload briefings** and chooses the finished Word file (or many at once). The issue number and date are read from the cover (or from file names like `IAA_Briefing_05_2026-02-15.docx`) and can be corrected before publishing. Uploading a number that already exists replaces that issue.
- **Staff** see the latest issue at the top of **Home**, read every issue as a web page, download the original Word file, and click **I’ve read this briefing** (this replaces the Signatures table). Management sees who has and hasn’t read each issue.
- **The Monday task** still builds the draft (lunch menu + placeholder). Once the finished version is written, uploading it is what publishes it.

## Roster

Management uploads the roster Excel file under **Roster → Upload roster** and chooses which tabs to show. The portal reads each half-month block (a heading such as “October , 2026”, the day numbers below it, then one row per shift). Home shows who’s on for a day; the Roster page shows the full grid and lets staff download the original file. Uploading a new file replaces what staff see.

## Passes & certificates

Each person records passes and certificates with expiry dates (never card or licence numbers). Reminders go to the person, with management copied, 30 days and 7 days before expiry and when expired. Management sees everyone under **Passes & certificates → Everyone**.

## Requests

- **Leave & availability:** private to the person and management. Management is emailed about new requests and approves or declines; the person is emailed the decision.
- **Stock, equipment & defects:** shared with all staff. Management, and station leads for their own stations, update the status. Vehicle defects and urgent requests are emailed to management straight away.
