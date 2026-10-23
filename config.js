// Portal settings. Fill in the two Supabase values from:
// Supabase → Project Settings → API (Project URL, and the anon/publishable key).
// The anon/publishable key is safe to keep here. NEVER put the service_role
// or secret key in this file or anywhere in the repository.

window.PORTAL_CONFIG = {
  supabaseUrl: "https://vqmfsfizrnvagffxmiqx.supabase.co",
  supabaseAnonKey: "sb_publishable_dxzSwsyVwNfvyjJmmxbVsg_qd0uzJ7D",

  companyName: "Iceland Aero Agents",
  portalName: "Staff Portal",

  // Sign-in options on the login screen, in this order.
  // "email"  – a one-time sign-in link sent by email (works straight away)
  // "google" – company Google Workspace accounts (enable in Supabase first)
  // "azure"  – company Microsoft 365 accounts (enable in Supabase first)
  signInMethods: ["email"]
};
