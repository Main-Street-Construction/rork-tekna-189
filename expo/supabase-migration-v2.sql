-- ============================================================
-- TEKNA v1.1.0 MIGRATION
-- Run in Supabase SQL Editor AFTER supabase-migration.sql
-- Safe to re-run (idempotent)
-- ============================================================

-- 1. EXTEND PROFILES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN full_name TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'claimed_gedcom_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN claimed_gedcom_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'claimed_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN claimed_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'access_requested_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN access_requested_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'access_notified_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN access_notified_at TIMESTAMPTZ;
  END IF;
END $$;

-- Allow users to update claim fields on own profile
DROP POLICY IF EXISTS "profiles_update_own_claim" ON profiles;
CREATE POLICY "profiles_update_own_claim" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 2. PUSH TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  platform TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON public.push_tokens(user_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_tokens_select_own" ON push_tokens;
CREATE POLICY "push_tokens_select_own" ON push_tokens
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_insert_own" ON push_tokens;
CREATE POLICY "push_tokens_insert_own" ON push_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_update_own" ON push_tokens;
CREATE POLICY "push_tokens_update_own" ON push_tokens
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_tokens_delete_own" ON push_tokens;
CREATE POLICY "push_tokens_delete_own" ON push_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- 3. SET PROFILE FULL NAME (signup only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_profile_full_name(full_name TEXT)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  trimmed TEXT := trim(full_name);
BEGIN
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF trimmed IS NULL OR length(trimmed) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Full name is required');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = caller_id AND full_name IS NOT NULL AND trim(full_name) <> ''
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Full name already set');
  END IF;

  UPDATE public.profiles
  SET
    full_name = trimmed,
    access_requested_at = COALESCE(access_requested_at, now())
  WHERE id = caller_id;

  RETURN json_build_object('success', true, 'user_id', caller_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. IDENTITY CLAIM RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_identity_claim(gedcom_id TEXT)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  trimmed_id TEXT := trim(gedcom_id);
BEGIN
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF trimmed_id IS NULL OR length(trimmed_id) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid person ID');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.individuals WHERE individuals.gedcom_id = trimmed_id) THEN
    RETURN json_build_object('success', false, 'error', 'Person not found in database');
  END IF;

  UPDATE public.profiles
  SET claimed_gedcom_id = trimmed_id, claimed_at = now()
  WHERE id = caller_id;

  RETURN json_build_object('success', true, 'gedcom_id', trimmed_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.clear_identity_claim()
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  UPDATE public.profiles
  SET claimed_gedcom_id = NULL, claimed_at = NULL
  WHERE id = caller_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_reset_user_claim(target_user_id UUID)
RETURNS JSON AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  UPDATE public.profiles
  SET claimed_gedcom_id = NULL, claimed_at = NULL
  WHERE id = target_user_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. PUSH TOKEN REGISTRATION
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_push_token(
  expo_push_token TEXT,
  platform TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  trimmed_token TEXT := trim(expo_push_token);
BEGIN
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF trimmed_token IS NULL OR length(trimmed_token) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid push token');
  END IF;

  INSERT INTO public.push_tokens (user_id, expo_push_token, platform, updated_at)
  VALUES (caller_id, trimmed_token, platform, now())
  ON CONFLICT (user_id, expo_push_token)
  DO UPDATE SET platform = EXCLUDED.platform, updated_at = now();

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.unregister_push_token(expo_push_token TEXT)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  DELETE FROM public.push_tokens
  WHERE user_id = caller_id AND expo_push_token = trim(expo_push_token);

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. ADMIN DELETE USER
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF target_user_id = caller_id THEN
    RETURN json_build_object('success', false, 'error', 'Cannot delete your own account');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  DELETE FROM auth.users WHERE id = target_user_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7. ENRICHED ADMIN LIST USERS
-- ============================================================
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
      p.full_name,
      p.is_enabled,
      p.is_admin,
      COALESCE(p.created_at, u.created_at) AS created_at,
      (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
      u.last_sign_in_at,
      p.claimed_gedcom_id,
      CASE
        WHEN p.claimed_gedcom_id IS NOT NULL THEN
          trim(concat_ws(' ', i.first_name, i.last_name))
        ELSE NULL
      END AS claimed_person_name
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.individuals i ON i.gedcom_id = p.claimed_gedcom_id
    ORDER BY COALESCE(p.created_at, u.created_at) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8. ADMIN LIST PENDING EDITS
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_pending_edits()
RETURNS TABLE (
  id UUID,
  tree_id TEXT,
  edit_type TEXT,
  target_id TEXT,
  data JSONB,
  submitted_by TEXT,
  submitted_at TIMESTAMPTZ,
  status TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewer_note TEXT,
  submitter_email TEXT,
  submitter_name TEXT
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: caller is not an admin';
  END IF;

  RETURN QUERY
    SELECT
      pe.id,
      pe.tree_id,
      pe.edit_type,
      pe.target_id,
      pe.data,
      pe.submitted_by,
      pe.submitted_at,
      pe.status,
      pe.reviewed_at,
      pe.reviewer_note,
      u.email::TEXT AS submitter_email,
      p.full_name AS submitter_name
    FROM public.pending_edits pe
    LEFT JOIN public.profiles p ON p.id::text = pe.submitted_by
    LEFT JOIN auth.users u ON u.id::text = pe.submitted_by
    WHERE pe.status = 'pending'
    ORDER BY pe.submitted_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 9. ADMIN GENEALOGY RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_search_individuals(
  search_query TEXT,
  result_limit INT DEFAULT 30
)
RETURNS TABLE (
  gedcom_id TEXT,
  first_name TEXT,
  last_name TEXT,
  gender TEXT,
  birth_date TEXT,
  birth_place TEXT,
  death_date TEXT,
  death_place TEXT,
  notes TEXT
) AS $$
DECLARE
  q TEXT := trim(search_query);
  lim INT := LEAST(GREATEST(COALESCE(result_limit, 30), 1), 100);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: caller is not an admin';
  END IF;

  IF q IS NULL OR length(q) < 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      i.gedcom_id,
      i.first_name,
      i.last_name,
      i.gender,
      i.birth_date,
      i.birth_place,
      i.death_date,
      i.death_place,
      i.notes
    FROM public.individuals i
    WHERE
      i.gedcom_id ILIKE '%' || q || '%'
      OR i.first_name ILIKE '%' || q || '%'
      OR i.last_name ILIKE '%' || q || '%'
      OR concat_ws(' ', i.first_name, i.last_name) ILIKE '%' || q || '%'
    ORDER BY i.last_name NULLS LAST, i.first_name NULLS LAST
    LIMIT lim;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_update_individual(
  target_gedcom_id TEXT,
  fields JSONB
)
RETURNS JSON AS $$
DECLARE
  gid TEXT := trim(target_gedcom_id);
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF gid IS NULL OR length(gid) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid gedcom_id');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.individuals WHERE gedcom_id = gid) THEN
    RETURN json_build_object('success', false, 'error', 'Person not found');
  END IF;

  UPDATE public.individuals
  SET
    first_name = COALESCE(fields->>'first_name', first_name),
    last_name = COALESCE(fields->>'last_name', last_name),
    gender = CASE WHEN fields ? 'gender' THEN fields->>'gender' ELSE gender END,
    birth_date = CASE WHEN fields ? 'birth_date' THEN fields->>'birth_date' ELSE birth_date END,
    birth_place = CASE WHEN fields ? 'birth_place' THEN fields->>'birth_place' ELSE birth_place END,
    death_date = CASE WHEN fields ? 'death_date' THEN fields->>'death_date' ELSE death_date END,
    death_place = CASE WHEN fields ? 'death_place' THEN fields->>'death_place' ELSE death_place END,
    notes = CASE WHEN fields ? 'notes' THEN fields->>'notes' ELSE notes END,
    updated_at = now()
  WHERE gedcom_id = gid;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_delete_individual(target_gedcom_id TEXT)
RETURNS JSON AS $$
DECLARE
  gid TEXT := trim(target_gedcom_id);
  ind_uuid UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT id INTO ind_uuid FROM public.individuals WHERE gedcom_id = gid LIMIT 1;

  IF ind_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Person not found');
  END IF;

  DELETE FROM public.family_members WHERE individual_id = ind_uuid;

  UPDATE public.families SET husband_id = NULL WHERE husband_id = ind_uuid;
  UPDATE public.families SET wife_id = NULL WHERE wife_id = ind_uuid;

  UPDATE public.profiles SET claimed_gedcom_id = NULL, claimed_at = NULL
  WHERE claimed_gedcom_id = gid;

  DELETE FROM public.individuals WHERE id = ind_uuid;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 10. NOTIFY ADMINS HELPER (called from Edge Function via service role)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_admin_push_targets()
RETURNS TABLE (
  expo_push_token TEXT,
  platform TEXT
) AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT pt.expo_push_token, pt.platform
    FROM public.push_tokens pt
    INNER JOIN public.profiles p ON p.id = pt.user_id
    WHERE p.is_admin = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.mark_access_notified(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.profiles
  SET access_notified_at = now()
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.should_notify_access_request(target_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  last_notified TIMESTAMPTZ;
BEGIN
  SELECT access_notified_at INTO last_notified
  FROM public.profiles WHERE id = target_user_id;

  IF last_notified IS NULL THEN
    RETURN true;
  END IF;

  RETURN last_notified < now() - interval '5 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_access_request_notification_payload(target_user_id UUID)
RETURNS JSON AS $$
DECLARE
  u_email TEXT;
  u_name TEXT;
BEGIN
  SELECT u.email::TEXT, p.full_name
  INTO u_email, u_name
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.id = target_user_id;

  RETURN json_build_object(
    'user_id', target_user_id,
    'email', COALESCE(u_email, 'unknown'),
    'full_name', COALESCE(NULLIF(trim(u_name), ''), 'New user')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- DEPLOY EDGE FUNCTION: supabase/functions/notify-admins-access-request
-- Invoke from app after set_profile_full_name succeeds.
-- ============================================================
