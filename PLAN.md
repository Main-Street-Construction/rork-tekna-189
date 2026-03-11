# Security Hardening — Remove Hard-Coded Admin & Clean Up Auth Logic

## What's changing

### 1. Remove hard-coded admin email

- The app currently has an email address baked into the code that automatically gets promoted to admin on sign-in
- This will be completely removed — no email-based auto-promotion at all
- Admin status must be set manually in the Supabase dashboard (`UPDATE profiles SET is_admin = true, is_enabled = true WHERE id = '...'`)
- The SQL migration comments will be updated to reflect this new setup process

### 2. Clean up client-side admin bootstrap logic

- The sign-in flow currently checks if the email matches the hard-coded admin email and auto-promotes that account
- All of that special-case logic will be removed from the profile creation process
- Profile creation on signup will simply create a default profile with `is_enabled: false, is_admin: false`
- The server-side trigger (already in place) handles this correctly — the client fallback will match

### 3. Simplify the AuthContext

- Remove the `ADMIN_EMAIL` constant entirely
- The `ensureProfileExists` function will no longer try to grant admin/enabled status based on email
- It will only create a basic disabled profile if the trigger didn't fire, and read existing profiles as-is
- Admin and enabled status are fully controlled server-side (via Supabase dashboard or admin RPC)

### 4. Update SQL migration docs

- Remove the comment referencing a specific email address
- Add clearer instructions: "Set your first admin manually via the Supabase dashboard"

### What stays the same

- Auth token storage remains in AsyncStorage (per your preference)
- All existing RLS policies stay intact
- Admin panel functionality unchanged
- Sign-in/sign-up flow unchanged for users
- Pending approval screen unchanged

