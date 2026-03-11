# Gate all data behind sign-in & approval + fix signup

## What this changes

### Issue 1: Data accessible without signing in
- The family tree data currently loads from Supabase for anyone, even without logging in
- **Fix**: Block all data fetching until the user is both signed in AND approved by you

### Issue 2: Signup failing ("Database error saving new user")
- The signup trigger may be failing silently — we'll add better error handling and a fallback that creates the profile row from the app if the trigger didn't fire

### Issue 3: Admin seeding
- Your email `charlemartel6@gmail.com` will be auto-promoted to admin + enabled when detected

---

## Features

- **Sign-in banner on all tabs**: When not signed in, every tab shows a friendly prompt with a "Sign In" button instead of data. The tab bar remains visible so the app feels navigable.
- **Pending Approval screen**: When signed in but not yet approved (`is_enabled = false`), users see a "Waiting for Approval" message with your contact info or a note. They can sign out if needed.
- **Data fully gated**: No Supabase queries fire until the user is signed in AND enabled — the family tree, search, relationships, and history tabs all respect this.
- **Signup fix**: Better error handling around the signup flow; if the automatic profile trigger fails, the app will gracefully handle it and show a clear message.
- **Admin auto-seed**: When `charlemartel6@gmail.com` signs in, the app checks if the profile exists and ensures it's marked as admin + enabled (as a one-time bootstrap).
- **Refresh approval status**: On the pending approval screen, a "Check Status" button lets the user re-check if they've been approved without restarting the app.

---

## Design

- **Sign-in prompt**: A clean card centered on each tab with a lock icon, a short message ("Sign in to access the family tree"), and an accent-colored "Sign In" button
- **Pending approval screen**: Full-screen overlay with a clock/shield icon, "Your account is awaiting approval" message, a subtle "Check Status" button, and a "Sign Out" option at the bottom
- **No layout changes**: Tab bar, headers, and navigation stay exactly the same — only the content area changes based on auth state

---

## Screens affected

1. **Root layout** (`_layout.tsx`) — Add an auth gate wrapper that checks sign-in + enabled status before rendering the main app content
2. **Search tab** — Show sign-in prompt when not authenticated
3. **Relationship tab** — Show sign-in prompt when not authenticated
4. **History tab** — Show sign-in prompt when not authenticated
5. **Profile tab** — Always accessible (it has the sign-in/sign-out buttons), but data sections hidden when not authenticated
6. **FamilyTreeContext** — Gate the data-loading query behind `isSignedIn && isEnabled`
7. **AuthContext** — Add fallback profile creation for failed triggers, admin auto-seed logic

---

## SQL note
Since you've already run the migration, no SQL changes needed. If signup still fails after this update, it likely means the trigger needs to be re-created — I'll include a small updated SQL snippet in comments for reference.
