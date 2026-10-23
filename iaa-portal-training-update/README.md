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
│   ├── config.js           ← your two Neon addresses go here
│   └── vendor/
│       ├── neon-js-0.7.0-beta.js   ← Neon's client library, bundled for the browser
│       └── jspdf-2.5.1.umd.min.js  ← creates the certificate PDFs
├── database/
│   ├── schema.sql          ← run first in Neon's SQL Editor
│   ├── 02-invitations.sql  ← run second: invitations and personal emails
│   ├── 03-fix-profile-save.sql ← only for databases set up before 23 Oct 2026, 2 pm
│   ├── 04-training.sql     ← training attempts, sign-offs, certificates
│   └── 05-import-old-training-records.sql ← records from the old training page
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
