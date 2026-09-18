-- ============================================================
-- Tekna migration v7
-- Fixes: person merge leaving parallel families, family admin tools,
--        clearer pending-edit submitter names
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================

-- Helper: merge one family into another (children + delete source)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_merge_families(
  keep_gedcom_id TEXT,
  merge_gedcom_id TEXT
)
RETURNS JSON AS $$
DECLARE
  keep_uuid UUID;
  merge_uuid UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF keep_gedcom_id IS NULL OR merge_gedcom_id IS NULL OR keep_gedcom_id = merge_gedcom_id THEN
    RETURN json_build_object('success', false, 'error', 'Invalid family IDs');
  END IF;

  SELECT id INTO keep_uuid FROM public.families WHERE gedcom_id = keep_gedcom_id LIMIT 1;
  SELECT id INTO merge_uuid FROM public.families WHERE gedcom_id = merge_gedcom_id LIMIT 1;

  IF keep_uuid IS NULL OR merge_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'One or both families not found');
  END IF;

  -- Move unique child links onto the keep family
  UPDATE public.family_members fm
  SET family_id = keep_uuid
  WHERE fm.family_id = merge_uuid
    AND fm.role = 'child'
    AND NOT EXISTS (
      SELECT 1 FROM public.family_members existing
      WHERE existing.family_id = keep_uuid
        AND existing.individual_id = fm.individual_id
        AND existing.role = 'child'
    );

  DELETE FROM public.family_members WHERE family_id = merge_uuid;
  DELETE FROM public.families WHERE id = merge_uuid;

  RETURN json_build_object('success', true, 'kept', keep_gedcom_id, 'merged', merge_gedcom_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_delete_family(target_gedcom_id TEXT)
RETURNS JSON AS $$
DECLARE
  fam_uuid UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT id INTO fam_uuid FROM public.families WHERE gedcom_id = target_gedcom_id LIMIT 1;
  IF fam_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Family not found');
  END IF;

  DELETE FROM public.family_members WHERE family_id = fam_uuid;
  DELETE FROM public.families WHERE id = fam_uuid;

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_update_family(
  target_gedcom_id TEXT,
  set_husband_gedcom_id TEXT DEFAULT NULL,
  set_wife_gedcom_id TEXT DEFAULT NULL,
  set_marriage_date TEXT DEFAULT NULL,
  set_marriage_place TEXT DEFAULT NULL,
  clear_husband BOOLEAN DEFAULT false,
  clear_wife BOOLEAN DEFAULT false
)
RETURNS JSON AS $$
DECLARE
  fam_uuid UUID;
  husband_uuid UUID;
  wife_uuid UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT id INTO fam_uuid FROM public.families WHERE gedcom_id = target_gedcom_id LIMIT 1;
  IF fam_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Family not found');
  END IF;

  IF set_husband_gedcom_id IS NOT NULL THEN
    SELECT id INTO husband_uuid FROM public.individuals WHERE gedcom_id = set_husband_gedcom_id LIMIT 1;
    IF husband_uuid IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Husband not found');
    END IF;
  END IF;

  IF set_wife_gedcom_id IS NOT NULL THEN
    SELECT id INTO wife_uuid FROM public.individuals WHERE gedcom_id = set_wife_gedcom_id LIMIT 1;
    IF wife_uuid IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Wife not found');
    END IF;
  END IF;

  UPDATE public.families
  SET
    husband_id = CASE
      WHEN clear_husband THEN NULL
      WHEN set_husband_gedcom_id IS NOT NULL THEN husband_uuid
      ELSE husband_id
    END,
    wife_id = CASE
      WHEN clear_wife THEN NULL
      WHEN set_wife_gedcom_id IS NOT NULL THEN wife_uuid
      ELSE wife_id
    END,
    marriage_date = COALESCE(set_marriage_date, marriage_date),
    marriage_place = COALESCE(set_marriage_place, marriage_place),
    updated_at = now()
  WHERE id = fam_uuid;

  RETURN json_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Person merge: remap refs, then collapse families that share the same parents
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_merge_individuals(
  keep_gedcom_id TEXT,
  merge_gedcom_id TEXT
)
RETURNS JSON AS $$
DECLARE
  keep_uuid UUID;
  merge_uuid UUID;
  dup RECORD;
  keep_family_gedcom TEXT;
  merge_family_gedcom TEXT;
  merged_families INT := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF keep_gedcom_id IS NULL OR merge_gedcom_id IS NULL OR keep_gedcom_id = merge_gedcom_id THEN
    RETURN json_build_object('success', false, 'error', 'Invalid merge IDs');
  END IF;

  SELECT id INTO keep_uuid FROM public.individuals WHERE gedcom_id = keep_gedcom_id LIMIT 1;
  SELECT id INTO merge_uuid FROM public.individuals WHERE gedcom_id = merge_gedcom_id LIMIT 1;

  IF keep_uuid IS NULL OR merge_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'One or both individuals not found');
  END IF;

  UPDATE public.families
  SET husband_id = keep_uuid
  WHERE husband_id = merge_uuid;

  UPDATE public.families
  SET wife_id = keep_uuid
  WHERE wife_id = merge_uuid;

  UPDATE public.family_members
  SET individual_id = keep_uuid
  WHERE individual_id = merge_uuid
    AND NOT EXISTS (
      SELECT 1 FROM public.family_members fm2
      WHERE fm2.family_id = family_members.family_id
        AND fm2.individual_id = keep_uuid
        AND fm2.role = family_members.role
    );

  DELETE FROM public.family_members WHERE individual_id = merge_uuid;

  UPDATE public.profiles
  SET claimed_gedcom_id = keep_gedcom_id
  WHERE claimed_gedcom_id = merge_gedcom_id;

  DELETE FROM public.individuals WHERE id = merge_uuid;

  -- Collapse parallel families that now share the same parents
  FOR dup IN
    SELECT f.husband_id, f.wife_id
    FROM public.families f
    WHERE f.husband_id IS NOT NULL OR f.wife_id IS NOT NULL
    GROUP BY f.husband_id, f.wife_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT f.gedcom_id INTO keep_family_gedcom
    FROM public.families f
    WHERE f.husband_id IS NOT DISTINCT FROM dup.husband_id
      AND f.wife_id IS NOT DISTINCT FROM dup.wife_id
    ORDER BY (
      SELECT COUNT(*) FROM public.family_members fm
      WHERE fm.family_id = f.id AND fm.role = 'child'
    ) DESC, f.gedcom_id
    LIMIT 1;

    FOR merge_family_gedcom IN
      SELECT f.gedcom_id
      FROM public.families f
      WHERE f.husband_id IS NOT DISTINCT FROM dup.husband_id
        AND f.wife_id IS NOT DISTINCT FROM dup.wife_id
        AND f.gedcom_id <> keep_family_gedcom
    LOOP
      PERFORM public.admin_merge_families(keep_family_gedcom, merge_family_gedcom);
      merged_families := merged_families + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'kept', keep_gedcom_id,
    'merged', merge_gedcom_id,
    'families_collapsed', merged_families
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Pending edits: fall back to signup metadata for submitter name
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
      COALESCE(
        NULLIF(trim(p.full_name), ''),
        NULLIF(trim(u.raw_user_meta_data->>'full_name'), ''),
        split_part(COALESCE(u.email::TEXT, ''), '@', 1)
      ) AS submitter_name
    FROM public.pending_edits pe
    LEFT JOIN public.profiles p ON p.id::text = pe.submitted_by
    LEFT JOIN auth.users u ON u.id::text = pe.submitted_by
    WHERE pe.status = 'pending'
    ORDER BY pe.submitted_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.admin_merge_families(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_family(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_family(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_merge_individuals(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_edits() TO authenticated;
