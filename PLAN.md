# Migrate to Supabase Auth with Admin Panel & RLS

This is a comprehensive auth migration. I'll build the client-side code and provide all SQL you need to run in Supabase.

---

## What Changes

### **Authentication**

- Replace the hardcoded admin password system with real Supabase Auth (email + password)
- Add a login/signup screen that appears when Supabase features are needed (viewing/editing cloud data, admin panel)
- Local GEDCOM file processing continues to work without auth
- Session persists automatically via Supabase's built-in token management

### **New Auth Context**

- New `AuthContext` that wraps the app, managing Supabase session state
- Exposes `user`, `profile` (with `is_enabled`, `is_admin`), `signIn`, `signUp`, `signOut`
- Fetches the user's `profiles` row on login to know their role
- Replaces the old hardcoded `ADMIN_PASSWORD` and `ADMIN_AUTHENTICATED_KEY` system entirely

### **Login / Signup Screen**

- New `/auth` route (modal presentation) with email + password fields
- Toggle between Sign In and Sign Up modes
- Clean design matching the app's warm earthy palette
- Shown when user tries to access cloud-dependent features without being signed in

### **Profile Tab Updates**

- Remove the old "Admin Login" password prompt section
- If signed in: show user email, admin badge if applicable, sign out button
- If not signed in: show "Sign In" button that opens the auth modal
- Admin section only visible when `is_admin = true` from the database (not a local password)
- The "Edit Profile" (display name, etc.) still works locally as before

### **Admin Panel**

- New `/admin` route — accessible only if `is_admin = true`
- Shows a list of all users fetched via a secure database function (not direct table query)
- Each user row shows email, enabled status toggle, admin status toggle
- Toggles call a secure database function to update user roles
- Cannot disable your own admin status (safety guard)
- Link to admin panel added in the profile tab's admin section

### **Data Access Changes**

- Enabled users can **read** all genealogy data (individuals, families, family_members)
- Only admins can **write** directly to genealogy tables
- Non-admin enabled users submit changes via `pending_edits` (existing flow, unchanged)
- Non-enabled users are blocked from all cloud data access by RLS

### **Existing Features Preserved**

- Local GEDCOM import/processing works without auth
- Search, relationship calculator work on locally cached data
- Profile display name, identity claim — all still local/AsyncStorage
- Pending edits workflow unchanged (just now tied to real user IDs instead of device IDs)

---

## SQL You'll Run in Supabase

I'll provide complete SQL scripts for you to execute in the Supabase SQL Editor:

1. `**profiles` table** — `id UUID` referencing `auth.users(id)` with `ON DELETE CASCADE`, columns `email`, `is_enabled` (default false), `is_admin` (default false), `created_at`
2. **Auto-create trigger** — On new `auth.users` insert, automatically creates a `profiles` row with `is_enabled=false`, `is_admin=false`
3. `**is_admin()` helper function** — `SECURITY DEFINER` function returning whether current user is admin
4. `**is_enabled()` helper function** — Similar for enabled check
5. **RLS policies on `profiles**` — Users can only read their own row; no client updates to `is_enabled`/`is_admin`; admins get full read access
6. **RLS policies on `individuals`, `families`, `family_members**` — Enabled users can read; only admins can write
7. **RLS policies on `pending_edits**` — Enabled users can insert and read their own; admins can read/update all
8. **RLS policies on `feedback**` — Enabled users can insert; admins can read all
9. `**admin_update_user` database function** — Secure RPC function callable from client that checks caller is admin, prevents self-demotion, and updates target user's `is_enabled`/`is_admin`
10. `**admin_list_users` database function** — Secure RPC function that returns all profiles (only callable by admins)

All SQL will include `DROP POLICY IF EXISTS` before creating new ones so it's safe to re-run. No existing policies will be dropped without being shown to you first.

---

## Files Changed

- **Supabase client** — Add auth session persistence with AsyncStorage
- **Auth context** — New shared context for auth state
- **Auth screen** — New login/signup modal
- **Admin screen** — New user management panel
- **Profile tab** — Replace hardcoded admin login with real auth UI
- **Family tree context** — Use real user ID instead of device ID for pending edits; admin check from auth context instead of password
- **Root layout** — Add auth context provider
- **Tab layout** — Register admin route
- **App layout** — Register new routes

