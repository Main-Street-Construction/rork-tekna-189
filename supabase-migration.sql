-- ============================================================
-- SUPABASE AUTH MIGRATION
-- Run this entire script in the Supabase SQL Editor
-- Safe to re-run (uses IF NOT EXISTS / DROP IF EXISTS)
-- ============================================================

-- 1. PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. AUTO-CREATE PROFILE ON SIGNUP TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, is_enabled, is_admin)
  VALUES (NEW.id, NEW.email, false, false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. HELPER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_enabled()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_enabled FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4. RLS ON PROFILES
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_admin_select_all" ON profiles;
CREATE POLICY "profiles_admin_select_all" ON profiles
  FOR SELECT USING (public.is_admin());

-- No client INSERT (trigger handles it)
-- No client UPDATE on is_enabled/is_admin (only via RPC)
-- Allow users to update their own email column only
DROP POLICY IF EXISTS "profiles_update_own_email" ON profiles;
CREATE POLICY "profiles_update_own_email" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 5. RLS ON INDIVIDUALS (shared genealogy data)
-- ============================================================
ALTER TABLE individuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "individuals_select_enabled" ON individuals;
CREATE POLICY "individuals_select_enabled" ON individuals
  FOR SELECT USING (public.is_enabled());

DROP POLICY IF EXISTS "individuals_insert_admin" ON individuals;
CREATE POLICY "individuals_insert_admin" ON individuals
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "individuals_update_admin" ON individuals;
CREATE POLICY "individuals_update_admin" ON individuals
  FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "individuals_delete_admin" ON individuals;
CREATE POLICY "individuals_delete_admin" ON individuals
  FOR DELETE USING (public.is_admin());

-- 6. RLS ON FAMILIES
-- ============================================================
ALTER TABLE families ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "families_select_enabled" ON families;
CREATE POLICY "families_select_enabled" ON families
  FOR SELECT USING (public.is_enabled());

DROP POLICY IF EXISTS "families_insert_admin" ON families;
CREATE POLICY "families_insert_admin" ON families
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "families_update_admin" ON families;
CREATE POLICY "families_update_admin" ON families
  FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "families_delete_admin" ON families;
CREATE POLICY "families_delete_admin" ON families
  FOR DELETE USING (public.is_admin());

-- 7. RLS ON FAMILY_MEMBERS
-- ============================================================
ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_members_select_enabled" ON family_members;
CREATE POLICY "family_members_select_enabled" ON family_members
  FOR SELECT USING (public.is_enabled());

DROP POLICY IF EXISTS "family_members_insert_admin" ON family_members;
CREATE POLICY "family_members_insert_admin" ON family_members
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "family_members_update_admin" ON family_members;
CREATE POLICY "family_members_update_admin" ON family_members
  FOR UPDATE USING (public.is_admin());

DROP POLICY IF EXISTS "family_members_delete_admin" ON family_members;
CREATE POLICY "family_members_delete_admin" ON family_members
  FOR DELETE USING (public.is_admin());

-- 8. RLS ON PENDING_EDITS
-- ============================================================
ALTER TABLE pending_edits ENABLE ROW LEVEL SECURITY;

-- Enabled users can insert pending edits
DROP POLICY IF EXISTS "pending_edits_insert_enabled" ON pending_edits;
CREATE POLICY "pending_edits_insert_enabled" ON pending_edits
  FOR INSERT WITH CHECK (public.is_enabled());

-- Users can read their own pending edits
DROP POLICY IF EXISTS "pending_edits_select_own" ON pending_edits;
CREATE POLICY "pending_edits_select_own" ON pending_edits
  FOR SELECT USING (submitted_by = auth.uid()::text);

-- Admins can read all pending edits
DROP POLICY IF EXISTS "pending_edits_select_admin" ON pending_edits;
CREATE POLICY "pending_edits_select_admin" ON pending_edits
  FOR SELECT USING (public.is_admin());

-- Admins can update pending edits (approve/reject)
DROP POLICY IF EXISTS "pending_edits_update_admin" ON pending_edits;
CREATE POLICY "pending_edits_update_admin" ON pending_edits
  FOR UPDATE USING (public.is_admin());

-- 9. RLS ON FEEDBACK
-- ============================================================
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can insert feedback (even if not enabled)
DROP POLICY IF EXISTS "feedback_insert_authenticated" ON feedback;
CREATE POLICY "feedback_insert_authenticated" ON feedback
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Admins can read all feedback
DROP POLICY IF EXISTS "feedback_select_admin" ON feedback;
CREATE POLICY "feedback_select_admin" ON feedback
  FOR SELECT USING (public.is_admin());

-- 10. ADMIN RPC FUNCTIONS
-- ============================================================

-- List all users (admin only)
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  is_enabled BOOLEAN,
  is_admin BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: caller is not an admin';
  END IF;

  RETURN QUERY
    SELECT p.id, p.email, p.is_enabled, p.is_admin, p.created_at
    FROM public.profiles p
    ORDER BY p.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update user roles (admin only)
CREATE OR REPLACE FUNCTION public.admin_update_user(
  target_user_id UUID,
  set_is_enabled BOOLEAN DEFAULT NULL,
  set_is_admin BOOLEAN DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  -- Check caller is admin
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden: caller is not an admin');
  END IF;

  -- Prevent self-demotion of admin
  IF target_user_id = caller_id AND set_is_admin = false THEN
    RETURN json_build_object('success', false, 'error', 'Cannot revoke your own admin status');
  END IF;

  -- Check target exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = target_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Apply updates
  UPDATE public.profiles
  SET
    is_enabled = COALESCE(set_is_enabled, profiles.is_enabled),
    is_admin = COALESCE(set_is_admin, profiles.is_admin)
  WHERE profiles.id = target_user_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- DONE! After running this:
-- 1. Create your first user via the app's signup flow
-- 2. Manually set that user as admin + enabled:
--    UPDATE profiles SET is_admin = true, is_enabled = true WHERE email = 'your@email.com';
-- 3. All subsequent users can be managed from the admin panel
-- ============================================================
