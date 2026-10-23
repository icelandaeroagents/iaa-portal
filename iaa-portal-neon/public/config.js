// Portal settings. Fill in the two Neon addresses from the Neon Console:
// – Auth URL:     Settings → Better Auth → Project Info (ends in /auth)
// – Data API URL: Postgres database → Data API (ends in /rest/v1)
// Both are safe to keep here. NEVER put the database connection string
// (the one starting postgresql:// with a password in it) in this file.

window.PORTAL_CONFIG = {
  neonAuthUrl: "https://ep-bold-block-b9yral3s.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth",
  neonDataApiUrl: "https://ep-bold-block-b9yral3s.apirest.c-7.eu-central-1.aws.neon.tech/neondb/rest/v1",

  companyName: "Iceland Aero Agents",
  portalName: "Staff Portal",

  // Who can sign in is decided by the database: invited email addresses,
  // plus any address on an allowed company domain (allowed_email_domains).

  // Sign-in options on the login screen, in this order.
  // "email"  – a one-time code sent by email (works straight away)
  // "google" – Google sign-in (set up OAuth in Neon first)
  signInMethods: ["email"]
};
