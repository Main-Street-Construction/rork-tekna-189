-- ============================================================
-- Tekna migration v8
-- Fixes: next GEDCOM IDs from cloud, push grants, submitter names
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================

-- 1. Allocate the next free I### / F### from the live database
-- ============================================================
CREATE TABLE IF NOT EXISTS public.gedcom_id_counters (
  prefix TEXT PRIMARY KEY,
  last_value BIGINT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.get_next_gedcom_id(id_prefix TEXT)
RETURNS JSON AS $$
DECLARE
  v_prefix TEXT := upper(trim(id_prefix));
  table_max BIGINT := 0;
  next_num BIGINT;
BEGIN
  IF NOT public.is_enabled() AND NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF v_prefix NOT IN ('I', 'F') THEN
    RETURN json_build_object('success', false, 'error', 'Prefix must be I or F');
  END IF;

  IF v_prefix = 'I' THEN
    SELECT COALESCE(MAX(substring(gedcom_id from 2)::BIGINT), 0)
      INTO table_max
      FROM public.individuals
     WHERE gedcom_id ~ ('^' || v_prefix || '[0-9]+$');
  ELSE
    SELECT COALESCE(MAX(substring(gedcom_id from 2)::BIGINT), 0)
      INTO table_max
      FROM public.families
     WHERE gedcom_id ~ ('^' || v_prefix || '[0-9]+$');
  END IF;

  INSERT INTO public.gedcom_id_counters (prefix, last_value)
  VALUES (v_prefix, table_max)
  ON CONFLICT (prefix) DO NOTHING;

  UPDATE public.gedcom_id_counters AS c
     SET last_value = GREATEST(c.last_value, table_max) + 1
   WHERE c.prefix = v_prefix
   RETURNING c.last_value INTO next_num;

  RETURN json_build_object(
    'success', true,
    'gedcom_id', v_prefix || next_num::TEXT,
    'next_number', next_num
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Pending edits: prefer snapshot fields, then profile, then auth metadata
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
      COALESCE(
        NULLIF(trim(pe.data->>'submitter_email'), ''),
        u.email::TEXT
      ) AS submitter_email,
      COALESCE(
        NULLIF(trim(pe.data->>'submitter_name'), ''),
        NULLIF(trim(p.full_name), ''),
        NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
        NULLIF(trim(concat_ws(' ',
          u.raw_user_meta_data->>'first_name',
          u.raw_user_meta_data->>'last_name'
        )), ''),
        NULLIF(split_part(COALESCE(u.email::TEXT, ''), '@', 1), ''),
        'Unknown user'
      ) AS submitter_name
    FROM public.pending_edits pe
    LEFT JOIN public.profiles p ON p.id::text = pe.submitted_by
    LEFT JOIN auth.users u ON u.id::text = pe.submitted_by
    WHERE pe.status = 'pending'
    ORDER BY pe.submitted_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Allow authenticated users to sync their display name after signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_profile_display_name(display_name TEXT)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  trimmed TEXT := trim(display_name);
BEGIN
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF trimmed IS NULL OR length(trimmed) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Name is required');
  END IF;

  INSERT INTO public.profiles (id, is_enabled, is_admin, full_name)
  VALUES (caller_id, false, false, trimmed)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Push token RPC grants (registration was failing silently for some roles)
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_next_gedcom_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_edits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_profile_display_name(TEXT) TO authenticated;

DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO authenticated;
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'Push token grant skipped: %', SQLERRM;
END $$;
