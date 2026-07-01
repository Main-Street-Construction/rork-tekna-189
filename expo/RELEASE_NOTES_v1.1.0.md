# Tekna v1.1.0 Release Notes

## What's New

- **Identity claim fix**: Claims are stored on the server and recovered from the database when missing locally.
- **Signup full name**: New users provide their full name when creating an account.
- **Admin panel**: Pending access queue, richer user details (name, last sign-in, claimed identity).
- **Admin push notifications**: Admins receive alerts when someone requests access (requires notification permission).
- **Pending edits review**: Before/after diffs, submitter info, filters, validation, and reject notes.
- **Genealogy Data Console**: Admins can search, edit, and delete individuals directly in Supabase.

## Deployment Steps

1. Run `expo/supabase-migration-v2.sql` in the Supabase SQL Editor (production).
2. Deploy Edge Function:
   ```bash
   supabase functions deploy notify-admins-access-request
   ```
3. Build and submit iOS update:
   ```bash
   cd expo
   eas build --platform ios --profile production
   eas submit --platform ios
   ```

## App Store "What's New" (short)

Identity claim fix, admin improvements, full name at signup, admin notifications for access requests, and a stronger edit review experience.
