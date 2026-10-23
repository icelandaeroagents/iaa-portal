# Iceland Aero Agents – Staff Portal

Internal portal for training, reports and station information.
Plain HTML, CSS and JavaScript – no build step. Data and logins are handled by Supabase.

```
iaa-portal/
├── public/            ← the website (this folder is what gets published)
│   ├── index.html
│   ├── styles.css
│   ├── app.js         ← sign-in, roles, navigation, sections
│   ├── config.js      ← your Supabase URL and key go here
│   └── _headers       ← security headers for Cloudflare Pages
├── supabase/
│   └── schema.sql     ← run once in Supabase to create the database
└── README.md
```

## 1. Set up the database (Supabase)

1. In your Supabase project, open **SQL Editor → New query**, paste all of `supabase/schema.sql` and click **Run**.
2. Go to **Authentication → URL Configuration**:
   - **Site URL:** `https://portal.iaa.is` (or the address you choose)
   - **Redirect URLs:** add the same address, your `*.pages.dev` address from Cloudflare, and `http://localhost:8080` for testing.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon / publishable key** into `public/config.js`.
   Never put the `service_role` / secret key in any file in this repository.

Only `@iaa.is` addresses can create an account. To allow another domain, run in the SQL Editor:
`insert into public.allowed_email_domains (domain) values ('example.is');`

## 2. Publish (Cloudflare Pages)

1. Push this folder to the private `iaa-portal` repository on GitHub.
2. In Cloudflare, create a Pages project connected to that repository.
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **public**
3. Every push to the main branch now publishes automatically.
4. Add the custom domain (for example `portal.iaa.is`) in the Pages project settings and follow the DNS instruction it shows.

## 3. Make yourself management

1. Open the portal and sign in with your company email (a sign-in link is emailed to you).
2. In the Supabase SQL Editor run, with your own address:
   `update public.profiles set role = 'management' where email = 'you@iaa.is';`
3. Reload the portal. You now see **People** and **Stations**, where you can give everyone else their role and station.

## Roles

| Role | Can see |
|---|---|
| Staff | Home, Training, Reports, their own details |
| Station lead | As staff, plus the staff list for their own station (used by later sections) |
| Management | Everything, including People, Stations and the audit log |

Role, station and access can only be changed by management – the database enforces this, not just the page.

## Before rolling out to all staff

- **Email sending:** Supabase's built-in email is for testing and only sends a few emails per hour. Set up your own email sender under **Authentication → Emails → SMTP Settings** before inviting everyone.
- **Company account sign-in (optional):** to use Google Workspace or Microsoft 365 sign-in, enable the provider under **Authentication → Sign In / Providers**, then add `"google"` or `"azure"` to `signInMethods` in `config.js`.
- **Backups:** check the backup option on your Supabase plan and agree who is responsible for restores.
- **Fonts:** the Barlow typeface loads from Google Fonts. If you prefer not to send staff browsers to Google, the fonts can be self-hosted in `public/`.

## Testing on your own computer

From the `public` folder run `python3 -m http.server 8080` and open http://localhost:8080.
