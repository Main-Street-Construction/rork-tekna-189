# Complete Password Reset Flow

## Overview
Add a new "Update Password" screen and wire up the full password reset flow so that when a user clicks the link in their reset email, the app opens and lets them set a new password.

---

**Features**
- When the user taps the reset link in their email, the app opens directly to the Update Password screen
- A form with **New Password** and **Confirm Password** fields, both with show/hide toggle
- Validation: passwords must match and be at least 6 characters
- On success, a confirmation message appears and the user is automatically redirected back after 2 seconds
- Errors (expired link, network issues, etc.) are shown clearly with a retry option

**Design**
- Matches the existing auth screen style — same warm earth-tone palette, rounded input cards, accent-colored buttons
- A shield/lock icon at the top with a clear "Set New Password" heading
- Same input group styling (card background, dividers, icons) as the sign-in/sign-up form
- Success state shows a green checkmark animation-style banner
- Clean and mobile-native, consistent with the rest of the app

**What will change**
1. **New screen** at `update-password` — the form where users type their new password
2. **Root layout** updated to register this new screen as a modal route
3. **Supabase client config** updated to detect the auth token from the reset link URL
4. **Auth context** updated to listen for the `PASSWORD_RECOVERY` event and navigate to the new screen automatically
5. **Reset password call** updated to include a `redirectTo` URL pointing back into the app

**Supabase Dashboard step (manual)**
- You'll need to add your app's deep link URL to the **Redirect URLs** list in Supabase Dashboard → Authentication → URL Configuration
