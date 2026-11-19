-- ============================================================
-- Tekna migration v13b
--
-- Bare I### from Tekna are NEW people. Matching @I123@ vs I123
-- is an ID-namespace collision, NOT proof of a duplicate.
-- This migration:
--   1. Audits ID collisions (informational — do NOT auto-merge)
--   2. Finds likely TRUE duplicates via name+birth + shared family
--   3. Fixes get_next_gedcom_id so Tekna never recycles past @I###@
--
-- No bulk auto-merge by ID. Merge only with admin_merge_individuals
-- after you confirm a pair.
-- Safe to re-run. Run after v13.
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_gedcom_id(raw TEXT)
RETURNS TEXT AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF raw IS NULL OR trim(raw) = '' THEN
    RETURN NULL;
  END IF;
  cleaned := upper(trim(raw));
  cleaned := regexp_replace(cleaned, '^@+', '');
  cleaned := regexp_replace(cleaned, '@+$', '');
  IF cleaned ~ '^[A-Z]+0+[0-9]+$' THEN
    cleaned := regexp_replace(cleaned, '^([A-Z]+)0+([0-9]+)$', '\1\2');
  END IF;
  RETURN cleaned;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Extract numeric part from I123 / @I123@ / F45 / @F45@
CREATE OR REPLACE FUNCTION public.gedcom_id_number(raw TEXT)
RETURNS BIGINT AS $$
DECLARE
  cleaned TEXT;
  digits TEXT;
BEGIN
  cleaned := public.normalize_gedcom_id(raw);
  IF cleaned IS NULL THEN
    RETURN NULL;
  END IF;
  digits := substring(cleaned from '[0-9]+');
  IF digits IS NULL OR digits = '' THEN
    RETURN NULL;
  END IF;
  RETURN digits::BIGINT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ------------------------------------------------------------
-- ID collisions: same number, different people (NOT duplicates)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_audit_gedcom_id_collisions()
RETURNS TABLE (
  norm_id TEXT,
  bare_gedcom_id TEXT,
  wrapped_gedcom_id TEXT,
  bare_name TEXT,
  wrapped_name TEXT,
  bare_birth TEXT,
  wrapped_birth TEXT,
  same_name BOOLEAN
) AS $$
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      i.gedcom_id,
      public.normalize_gedcom_id(i.gedcom_id) AS norm,
      lower(trim(coalesce(i.first_name, ''))) AS first_norm,
      lower(trim(coalesce(i.last_name, ''))) AS last_norm,
      trim(coalesce(i.first_name, '') || ' ' || coalesce(i.last_name, '')) AS display_name,
      i.birth_date,
      (i.gedcom_id LIKE '@%@') AS has_at_wrappers
    FROM public.individuals i
  )
  SELECT
    bare.norm,
    bare.gedcom_id,
    wrapped.gedcom_id,
    bare.display_name,
    wrapped.display_name,
    bare.birth_date,
    wrapped.birth_date,
    (bare.first_norm = wrapped.first_norm AND bare.last_norm = wrapped.last_norm) AS same_name
  FROM base bare
  JOIN base wrapped
    ON wrapped.norm = bare.norm
   AND bare.has_at_wrappers = false
   AND wrapped.has_at_wrappers = true
  WHERE bare.norm IS NOT NULL
  ORDER BY
    (bare.first_norm = wrapped.first_norm AND bare.last_norm = wrapped.last_norm) DESC,
    bare.norm;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- Likely TRUE duplicates: require last name + shared family evidence
-- Evidence = same spouse OR same parent family OR same child
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_audit_likely_true_duplicates()
RETURNS TABLE (
  first_name_norm TEXT,
  last_name_norm TEXT,
  birth_date TEXT,
  person_count BIGINT,
  gedcom_ids TEXT[],
  display_names TEXT[],
  shared_evidence TEXT[],
  evidence_score INT
) AS $$
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH named AS (
    SELECT
      i.id,
      i.gedcom_id,
      lower(trim(coalesce(i.first_name, ''))) AS first_norm,
      lower(trim(coalesce(i.last_name, ''))) AS last_norm,
      i.birth_date,
      trim(coalesce(i.first_name, '') || ' ' || coalesce(i.last_name, '')) AS display_name
    FROM public.individuals i
    WHERE coalesce(trim(i.last_name), '') <> ''
      AND coalesce(trim(i.first_name), '') <> ''
  ),
  groups AS (
    SELECT
      n.first_norm,
      n.last_norm,
      n.birth_date,
      COUNT(*)::BIGINT AS person_count,
      array_agg(n.id ORDER BY n.gedcom_id) AS ids,
      array_agg(n.gedcom_id ORDER BY n.gedcom_id) AS gedcom_ids,
      array_agg(n.display_name ORDER BY n.gedcom_id) AS display_names
    FROM named n
    GROUP BY n.first_norm, n.last_norm, n.birth_date
    HAVING COUNT(*) > 1
  ),
  -- spouse evidence: two candidates are husband/wife of the same partner
  spouse_ev AS (
    SELECT
      g.first_norm,
      g.last_norm,
      g.birth_date,
      'shared_spouse:' || coalesce(partner.gedcom_id, partner.id::text) AS evidence
    FROM groups g
    JOIN unnest(g.ids) WITH ORDINALITY AS a(id, ord) ON true
    JOIN unnest(g.ids) WITH ORDINALITY AS b(id, ord) ON b.ord > a.ord
    JOIN public.families fa ON fa.husband_id = a.id OR fa.wife_id = a.id
    JOIN public.families fb ON fb.husband_id = b.id OR fb.wife_id = b.id
    JOIN public.individuals partner ON partner.id = CASE
      WHEN fa.husband_id = a.id THEN fa.wife_id
      ELSE fa.husband_id
    END
    WHERE partner.id IS NOT NULL
      AND partner.id = CASE
        WHEN fb.husband_id = b.id THEN fb.wife_id
        ELSE fb.husband_id
      END
  ),
  -- parent evidence: both are children in the same family
  parent_ev AS (
    SELECT
      g.first_norm,
      g.last_norm,
      g.birth_date,
      'shared_parent_family:' || f.gedcom_id AS evidence
    FROM groups g
    JOIN unnest(g.ids) WITH ORDINALITY AS a(id, ord) ON true
    JOIN unnest(g.ids) WITH ORDINALITY AS b(id, ord) ON b.ord > a.ord
    JOIN public.family_members fma ON fma.individual_id = a.id AND fma.role = 'child'
    JOIN public.family_members fmb ON fmb.individual_id = b.id AND fmb.role = 'child'
     AND fmb.family_id = fma.family_id
    JOIN public.families f ON f.id = fma.family_id
  ),
  -- child evidence: both appear as parent of the same child
  child_ev AS (
    SELECT
      g.first_norm,
      g.last_norm,
      g.birth_date,
      'shared_child:' || child.gedcom_id AS evidence
    FROM groups g
    JOIN unnest(g.ids) WITH ORDINALITY AS a(id, ord) ON true
    JOIN unnest(g.ids) WITH ORDINALITY AS b(id, ord) ON b.ord > a.ord
    JOIN public.families fa ON fa.husband_id = a.id OR fa.wife_id = a.id
    JOIN public.families fb ON fb.husband_id = b.id OR fb.wife_id = b.id
    JOIN public.family_members cma ON cma.family_id = fa.id AND cma.role = 'child'
    JOIN public.family_members cmb ON cmb.family_id = fb.id AND cmb.role = 'child'
     AND cmb.individual_id = cma.individual_id
    JOIN public.individuals child ON child.id = cma.individual_id
  ),
  all_ev AS (
    SELECT * FROM spouse_ev
    UNION ALL
    SELECT * FROM parent_ev
    UNION ALL
    SELECT * FROM child_ev
  ),
  scored AS (
    SELECT
      g.first_norm,
      g.last_norm,
      g.birth_date,
      g.person_count,
      g.gedcom_ids,
      g.display_names,
      coalesce(
        (SELECT array_agg(DISTINCT e.evidence ORDER BY e.evidence)
         FROM all_ev e
         WHERE e.first_norm = g.first_norm
           AND e.last_norm = g.last_norm
           AND e.birth_date IS NOT DISTINCT FROM g.birth_date),
        ARRAY[]::TEXT[]
      ) AS shared_evidence
    FROM groups g
  )
  SELECT
    s.first_norm,
    s.last_norm,
    s.birth_date,
    s.person_count,
    s.gedcom_ids,
    s.display_names,
    s.shared_evidence,
    coalesce(array_length(s.shared_evidence, 1), 0)::INT AS evidence_score
  FROM scored s
  WHERE coalesce(array_length(s.shared_evidence, 1), 0) > 0
  ORDER BY evidence_score DESC, s.person_count DESC, s.last_norm, s.first_norm;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Name+birth dupes with last name (candidates — no family proof yet)
CREATE OR REPLACE FUNCTION public.admin_audit_duplicate_people_strong()
RETURNS TABLE (
  first_name_norm TEXT,
  last_name_norm TEXT,
  birth_date TEXT,
  person_count BIGINT,
  gedcom_ids TEXT[],
  display_names TEXT[],
  is_at_vs_bare_collision BOOLEAN
) AS $$
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    lower(trim(coalesce(i.first_name, ''))) AS first_name_norm,
    lower(trim(coalesce(i.last_name, ''))) AS last_name_norm,
    i.birth_date,
    COUNT(*)::BIGINT AS person_count,
    array_agg(i.gedcom_id ORDER BY i.gedcom_id) AS gedcom_ids,
    array_agg(
      trim(coalesce(i.first_name, '') || ' ' || coalesce(i.last_name, ''))
      ORDER BY i.gedcom_id
    ) AS display_names,
    -- true when the ONLY difference is @ wrappers on the same number
    (
      COUNT(*) = 2
      AND COUNT(DISTINCT public.normalize_gedcom_id(i.gedcom_id)) = 1
      AND bool_or(i.gedcom_id LIKE '@%@')
      AND bool_or(i.gedcom_id NOT LIKE '@%@')
    ) AS is_at_vs_bare_collision
  FROM public.individuals i
  WHERE coalesce(trim(i.last_name), '') <> ''
    AND coalesce(trim(i.first_name), '') <> ''
  GROUP BY lower(trim(coalesce(i.first_name, ''))),
           lower(trim(coalesce(i.last_name, ''))),
           i.birth_date
  HAVING COUNT(*) > 1
  ORDER BY person_count DESC, last_name_norm, first_name_norm;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- Fix ID allocation: count BOTH bare I123 and @I123@
-- so Tekna never mints a number already used by GEDCOM import
-- ------------------------------------------------------------
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
    SELECT COALESCE(MAX(public.gedcom_id_number(gedcom_id)), 0)
      INTO table_max
      FROM public.individuals
     WHERE public.normalize_gedcom_id(gedcom_id) LIKE v_prefix || '%';
  ELSE
    SELECT COALESCE(MAX(public.gedcom_id_number(gedcom_id)), 0)
      INTO table_max
      FROM public.families
     WHERE public.normalize_gedcom_id(gedcom_id) LIKE v_prefix || '%';
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

GRANT EXECUTE ON FUNCTION public.normalize_gedcom_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gedcom_id_number(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_gedcom_id_collisions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_likely_true_duplicates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_duplicate_people_strong() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_gedcom_id(TEXT) TO authenticated;
