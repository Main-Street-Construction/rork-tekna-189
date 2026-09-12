-- ============================================================
-- Tekna migration v5
-- Fixes: signup full_name persistence, admin delete user
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================

-- 1. handle_new_user: copy full_name from signup metadata
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  meta_name TEXT := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '');
BEGIN
  INSERT INTO public.profiles (id, is_enabled, is_admin, full_name, access_requested_at)
  VALUES (
    NEW.id,
    false,
    false,
    meta_name,
    CASE WHEN meta_name IS NOT NULL THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO UPDATE
    SET
      full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
      access_requested_at = COALESCE(public.profiles.access_requested_at, EXCLUDED.access_requested_at);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. set_profile_full_name: idempotent when name already set
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_profile_full_name(full_name TEXT)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  trimmed TEXT := trim(full_name);
  existing TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF trimmed IS NULL OR length(trimmed) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Full name is required');
  END IF;

  SELECT p.full_name INTO existing
  FROM public.profiles p
  WHERE p.id = caller_id;

  IF existing IS NOT NULL AND trim(existing) <> '' THEN
    -- Already set (e.g. by signup metadata trigger) — treat as success
    UPDATE public.profiles
    SET access_requested_at = COALESCE(access_requested_at, now())
    WHERE id = caller_id;
    RETURN json_build_object('success', true, 'user_id', caller_id, 'already_set', true);
  END IF;

  UPDATE public.profiles
  SET
    full_name = trimmed,
    access_requested_at = COALESCE(access_requested_at, now())
  WHERE id = caller_id;

  RETURN json_build_object('success', true, 'user_id', caller_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. admin_delete_user: drop + recreate with clearer errors
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_delete_user(UUID);

CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF target_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Missing user id');
  END IF;

  IF target_user_id = caller_id THEN
    RETURN json_build_object('success', false, 'error', 'Cannot delete your own account');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id)
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Clean app data first (in case auth delete is restricted)
  DELETE FROM public.push_tokens WHERE user_id = target_user_id;
  DELETE FROM public.profiles WHERE id = target_user_id;

  BEGIN
    DELETE FROM auth.users WHERE id = target_user_id;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Profile removed but auth user delete requires the admin-delete-user Edge Function'
    );
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
  END;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Prefer postgres ownership so auth.users deletes succeed when possible
DO $$
BEGIN
  ALTER FUNCTION public.admin_delete_user(UUID) OWNER TO postgres;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not reassign admin_delete_user owner: %', SQLERRM;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_full_name(TEXT) TO authenticated;

-- 4. Backfill names from auth user_metadata when profile.full_name is empty
-- ============================================================
UPDATE public.profiles p
SET
  full_name = NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
  access_requested_at = COALESCE(
    p.access_requested_at,
    CASE
      WHEN NULLIF(trim(u.raw_user_meta_data->>'full_name'), '') IS NOT NULL THEN now()
      ELSE NULL
    END
  )
FROM auth.users u
WHERE u.id = p.id
  AND (p.full_name IS NULL OR trim(p.full_name) = '')
  AND NULLIF(trim(COALESCE(u.raw_user_meta_data->>'full_name', '')), '') IS NOT NULL;
