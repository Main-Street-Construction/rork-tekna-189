-- ============================================================
-- Tekna migration v6
-- Fixes: admin panel names, signup name trigger, notify payload
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_requested_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_notified_at TIMESTAMPTZ;

-- 1. Copy signup name onto the profile even when email confirmation is on
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
      full_name = COALESCE(NULLIF(trim(public.profiles.full_name), ''), EXCLUDED.full_name),
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

-- 2. Admin list falls back to signup metadata when profile.full_name is empty
-- ============================================================
DROP FUNCTION IF EXISTS public.admin_list_users_with_email();

CREATE OR REPLACE FUNCTION public.admin_list_users_with_email()
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  is_enabled BOOLEAN,
  is_admin BOOLEAN,
  created_at TIMESTAMPTZ,
  email_confirmed BOOLEAN,
  last_sign_in_at TIMESTAMPTZ,
  claimed_gedcom_id TEXT,
  claimed_person_name TEXT
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: caller is not an admin';
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      u.email::TEXT,
      COALESCE(
        NULLIF(trim(p.full_name), ''),
        NULLIF(trim(u.raw_user_meta_data->>'full_name'), '')
      ) AS full_name,
      p.is_enabled,
      p.is_admin,
      COALESCE(p.created_at, u.created_at) AS created_at,
      (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
      u.last_sign_in_at,
      p.claimed_gedcom_id,
      CASE
        WHEN p.claimed_gedcom_id IS NOT NULL THEN
          NULLIF(trim(concat_ws(' ', i.first_name, i.last_name)), '')
        ELSE NULL
      END AS claimed_person_name
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.individuals i ON i.gedcom_id = p.claimed_gedcom_id
    ORDER BY COALESCE(p.created_at, u.created_at) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Notification payload uses the same name fallback
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_access_request_notification_payload(target_user_id UUID)
RETURNS JSON AS $$
DECLARE
  u_email TEXT;
  u_name TEXT;
BEGIN
  SELECT
    u.email::TEXT,
    COALESCE(
      NULLIF(trim(p.full_name), ''),
      NULLIF(trim(u.raw_user_meta_data->>'full_name'), '')
    )
  INTO u_email, u_name
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.id = target_user_id;

  RETURN json_build_object(
    'user_id', target_user_id,
    'email', COALESCE(u_email, 'unknown'),
    'full_name', COALESCE(u_name, 'New user')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

GRANT EXECUTE ON FUNCTION public.admin_list_users_with_email() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_full_name(TEXT) TO authenticated;

DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.get_admin_push_targets() TO service_role;
  GRANT EXECUTE ON FUNCTION public.should_notify_access_request(UUID) TO service_role;
  GRANT EXECUTE ON FUNCTION public.get_access_request_notification_payload(UUID) TO service_role;
  GRANT EXECUTE ON FUNCTION public.mark_access_notified(UUID) TO service_role;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Push helper grant skipped: %', SQLERRM;
END $$;

-- 4. Backfill profile names from signup metadata
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
