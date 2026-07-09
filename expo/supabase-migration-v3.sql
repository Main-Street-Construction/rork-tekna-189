-- Tekna migration v3: user search + admin merge
-- Run in Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.search_individuals(
  search_query TEXT,
  result_limit INT DEFAULT 50
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
  lim INT := LEAST(GREATEST(COALESCE(result_limit, 50), 1), 100);
BEGIN
  IF NOT public.is_enabled() THEN
    RAISE EXCEPTION 'Forbidden: user is not enabled';
  END IF;

  IF q IS NULL OR length(q) < 2 THEN
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

CREATE OR REPLACE FUNCTION public.admin_merge_individuals(
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

  RETURN json_build_object('success', true, 'kept', keep_gedcom_id, 'merged', merge_gedcom_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
