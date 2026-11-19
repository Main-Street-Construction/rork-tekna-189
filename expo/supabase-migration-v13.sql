-- ============================================================
-- Tekna migration v13
-- Data integrity: audit report + fix RPCs (parent links, notes,
-- duplicate memberships, parallel families). Safe to re-run.
--
-- Auth: when called from the app, requires an admin JWT.
-- When run in the Supabase SQL Editor (no JWT / auth.uid() null),
-- calls are allowed so you can audit and fix from SQL directly.
-- ============================================================

-- Shared gate: block non-admins on the API; allow SQL Editor / service role
CREATE OR REPLACE FUNCTION public.require_admin_or_sql()
RETURNS BOOLEAN AS $$
  SELECT auth.uid() IS NULL OR public.is_admin();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Loosen nested merge helpers so SQL-editor fix tools can call them
CREATE OR REPLACE FUNCTION public.admin_merge_families(
  keep_gedcom_id TEXT,
  merge_gedcom_id TEXT
)
RETURNS JSON AS $$
DECLARE
  keep_uuid UUID;
  merge_uuid UUID;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
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

-- ------------------------------------------------------------
-- 1) Summary counts
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_audit_integrity_summary()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT json_build_object(
    'success', true,
    'generated_at', now(),
    'counts', json_build_object(
      'individuals', (SELECT COUNT(*) FROM public.individuals),
      'families', (SELECT COUNT(*) FROM public.families),
      'family_members', (SELECT COUNT(*) FROM public.family_members),
      'children_in_multiple_families', (
        SELECT COUNT(*) FROM (
          SELECT fm.individual_id
          FROM public.family_members fm
          WHERE fm.role = 'child'
          GROUP BY fm.individual_id
          HAVING COUNT(DISTINCT fm.family_id) > 1
        ) t
      ),
      'parallel_parent_families', (
        SELECT COUNT(*) FROM (
          SELECT f.husband_id, f.wife_id
          FROM public.families f
          WHERE f.husband_id IS NOT NULL OR f.wife_id IS NOT NULL
          GROUP BY f.husband_id, f.wife_id
          HAVING COUNT(*) > 1
        ) t
      ),
      'duplicate_membership_rows', (
        SELECT COALESCE(SUM(cnt - 1), 0) FROM (
          SELECT COUNT(*) AS cnt
          FROM public.family_members
          GROUP BY family_id, individual_id, role
          HAVING COUNT(*) > 1
        ) d
      ),
      'orphan_member_rows', (
        SELECT COUNT(*)
        FROM public.family_members fm
        LEFT JOIN public.individuals i ON i.id = fm.individual_id
        LEFT JOIN public.families f ON f.id = fm.family_id
        WHERE i.id IS NULL OR f.id IS NULL
      ),
      'broken_spouse_fks', (
        SELECT COUNT(*)
        FROM public.families f
        LEFT JOIN public.individuals h ON h.id = f.husband_id
        LEFT JOIN public.individuals w ON w.id = f.wife_id
        WHERE (f.husband_id IS NOT NULL AND h.id IS NULL)
           OR (f.wife_id IS NOT NULL AND w.id IS NULL)
      ),
      'duplicate_people_name_birth', (
        SELECT COUNT(*) FROM (
          SELECT 1
          FROM public.individuals
          WHERE coalesce(trim(first_name), '') <> '' OR coalesce(trim(last_name), '') <> ''
          GROUP BY lower(trim(coalesce(first_name, ''))),
                   lower(trim(coalesce(last_name, ''))),
                   birth_date
          HAVING COUNT(*) > 1
        ) t
      ),
      'duplicate_note_texts', (
        SELECT COUNT(*) FROM (
          SELECT 1
          FROM public.individuals
          WHERE notes IS NOT NULL AND trim(notes) <> ''
          GROUP BY notes
          HAVING COUNT(*) > 1
        ) t
      ),
      'families_with_no_parents', (
        SELECT COUNT(*)
        FROM public.families
        WHERE husband_id IS NULL AND wife_id IS NULL
      ),
      'families_with_no_children', (
        SELECT COUNT(*)
        FROM public.families f
        WHERE NOT EXISTS (
          SELECT 1 FROM public.family_members fm
          WHERE fm.family_id = f.id AND fm.role = 'child'
        )
      )
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 2) Detail audits (table-returning)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_audit_multi_family_children()
RETURNS TABLE (
  child_gedcom_id TEXT,
  first_name TEXT,
  last_name TEXT,
  birth_date TEXT,
  family_count BIGINT,
  family_gedcom_ids TEXT[],
  parent_pairs TEXT[]
) AS $$
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    i.gedcom_id,
    i.first_name,
    i.last_name,
    i.birth_date,
    COUNT(DISTINCT fm.family_id)::BIGINT AS family_count,
    array_agg(DISTINCT f.gedcom_id) AS family_gedcom_ids,
    array_agg(DISTINCT (
      coalesce(h.gedcom_id, '?') || ' + ' || coalesce(w.gedcom_id, '?')
      || ' [' || coalesce(h.first_name, '') || ' ' || coalesce(h.last_name, '')
      || ' / ' || coalesce(w.first_name, '') || ' ' || coalesce(w.last_name, '') || ']'
    )) AS parent_pairs
  FROM public.family_members fm
  JOIN public.individuals i ON i.id = fm.individual_id
  JOIN public.families f ON f.id = fm.family_id
  LEFT JOIN public.individuals h ON h.id = f.husband_id
  LEFT JOIN public.individuals w ON w.id = f.wife_id
  WHERE fm.role = 'child'
  GROUP BY i.id, i.gedcom_id, i.first_name, i.last_name, i.birth_date
  HAVING COUNT(DISTINCT fm.family_id) > 1
  ORDER BY family_count DESC, i.last_name, i.first_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_audit_parallel_families()
RETURNS TABLE (
  husband_gedcom_id TEXT,
  wife_gedcom_id TEXT,
  husband_name TEXT,
  wife_name TEXT,
  family_count BIGINT,
  family_gedcom_ids TEXT[],
  child_counts INT[]
) AS $$
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    h.gedcom_id AS husband_gedcom_id,
    w.gedcom_id AS wife_gedcom_id,
    trim(coalesce(h.first_name, '') || ' ' || coalesce(h.last_name, '')) AS husband_name,
    trim(coalesce(w.first_name, '') || ' ' || coalesce(w.last_name, '')) AS wife_name,
    COUNT(*)::BIGINT AS family_count,
    array_agg(f.gedcom_id ORDER BY f.gedcom_id) AS family_gedcom_ids,
    array_agg((
      SELECT COUNT(*)::INT FROM public.family_members fm
      WHERE fm.family_id = f.id AND fm.role = 'child'
    ) ORDER BY f.gedcom_id) AS child_counts
  FROM public.families f
  LEFT JOIN public.individuals h ON h.id = f.husband_id
  LEFT JOIN public.individuals w ON w.id = f.wife_id
  WHERE f.husband_id IS NOT NULL OR f.wife_id IS NOT NULL
  GROUP BY f.husband_id, f.wife_id, h.gedcom_id, w.gedcom_id, h.first_name, h.last_name, w.first_name, w.last_name
  HAVING COUNT(*) > 1
  ORDER BY family_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_audit_duplicate_people()
RETURNS TABLE (
  first_name_norm TEXT,
  last_name_norm TEXT,
  birth_date TEXT,
  person_count BIGINT,
  gedcom_ids TEXT[],
  display_names TEXT[]
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
    ) AS display_names
  FROM public.individuals i
  WHERE coalesce(trim(i.first_name), '') <> '' OR coalesce(trim(i.last_name), '') <> ''
  GROUP BY lower(trim(coalesce(i.first_name, ''))),
           lower(trim(coalesce(i.last_name, ''))),
           i.birth_date
  HAVING COUNT(*) > 1
  ORDER BY person_count DESC, last_name_norm, first_name_norm;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_audit_duplicate_notes()
RETURNS TABLE (
  note_preview TEXT,
  note_length INT,
  person_count BIGINT,
  gedcom_ids TEXT[],
  display_names TEXT[]
) AS $$
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    left(i.notes, 160) AS note_preview,
    length(i.notes)::INT AS note_length,
    COUNT(*)::BIGINT AS person_count,
    array_agg(i.gedcom_id ORDER BY i.gedcom_id) AS gedcom_ids,
    array_agg(
      trim(coalesce(i.first_name, '') || ' ' || coalesce(i.last_name, ''))
      ORDER BY i.gedcom_id
    ) AS display_names
  FROM public.individuals i
  WHERE i.notes IS NOT NULL AND trim(i.notes) <> ''
  GROUP BY i.notes
  HAVING COUNT(*) > 1
  ORDER BY person_count DESC, note_length DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_audit_orphan_links()
RETURNS TABLE (
  issue TEXT,
  family_gedcom_id TEXT,
  child_gedcom_id TEXT,
  family_uuid UUID,
  individual_uuid UUID,
  role TEXT
) AS $$
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT 'missing_child'::TEXT, f.gedcom_id, NULL::TEXT, fm.family_id, fm.individual_id, fm.role
  FROM public.family_members fm
  LEFT JOIN public.individuals i ON i.id = fm.individual_id
  LEFT JOIN public.families f ON f.id = fm.family_id
  WHERE i.id IS NULL

  UNION ALL

  SELECT 'missing_family'::TEXT, NULL::TEXT, i.gedcom_id, fm.family_id, fm.individual_id, fm.role
  FROM public.family_members fm
  LEFT JOIN public.families f ON f.id = fm.family_id
  LEFT JOIN public.individuals i ON i.id = fm.individual_id
  WHERE f.id IS NULL

  UNION ALL

  SELECT 'broken_husband_fk'::TEXT, f.gedcom_id, NULL::TEXT, f.id, f.husband_id, 'husband'::TEXT
  FROM public.families f
  LEFT JOIN public.individuals h ON h.id = f.husband_id
  WHERE f.husband_id IS NOT NULL AND h.id IS NULL

  UNION ALL

  SELECT 'broken_wife_fk'::TEXT, f.gedcom_id, NULL::TEXT, f.id, f.wife_id, 'wife'::TEXT
  FROM public.families f
  LEFT JOIN public.individuals w ON w.id = f.wife_id
  WHERE f.wife_id IS NOT NULL AND w.id IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_audit_child_parent_map(p_child_gedcom_id TEXT DEFAULT NULL)
RETURNS TABLE (
  child_gedcom_id TEXT,
  child_name TEXT,
  child_birth TEXT,
  family_gedcom_id TEXT,
  husband_gedcom_id TEXT,
  husband_name TEXT,
  wife_gedcom_id TEXT,
  wife_name TEXT
) AS $$
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    i.gedcom_id,
    trim(coalesce(i.first_name, '') || ' ' || coalesce(i.last_name, '')),
    i.birth_date,
    f.gedcom_id,
    h.gedcom_id,
    trim(coalesce(h.first_name, '') || ' ' || coalesce(h.last_name, '')),
    w.gedcom_id,
    trim(coalesce(w.first_name, '') || ' ' || coalesce(w.last_name, ''))
  FROM public.family_members fm
  JOIN public.individuals i ON i.id = fm.individual_id
  JOIN public.families f ON f.id = fm.family_id
  LEFT JOIN public.individuals h ON h.id = f.husband_id
  LEFT JOIN public.individuals w ON w.id = f.wife_id
  WHERE fm.role = 'child'
    AND (p_child_gedcom_id IS NULL OR i.gedcom_id = p_child_gedcom_id)
  ORDER BY i.last_name, i.first_name, f.gedcom_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- 3) Fix RPCs
-- ------------------------------------------------------------

-- Remove a child from one family (wrong parent link)
CREATE OR REPLACE FUNCTION public.admin_unlink_child(
  child_gedcom_id TEXT,
  family_gedcom_id TEXT
)
RETURNS JSON AS $$
DECLARE
  child_uuid UUID;
  fam_uuid UUID;
  deleted_count INT;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT id INTO child_uuid FROM public.individuals WHERE gedcom_id = child_gedcom_id LIMIT 1;
  SELECT id INTO fam_uuid FROM public.families WHERE gedcom_id = family_gedcom_id LIMIT 1;

  IF child_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Child not found');
  END IF;
  IF fam_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Family not found');
  END IF;

  DELETE FROM public.family_members
  WHERE family_id = fam_uuid
    AND individual_id = child_uuid
    AND role = 'child';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count = 0 THEN
    RETURN json_build_object('success', false, 'error', 'No child link found for that family');
  END IF;

  RETURN json_build_object(
    'success', true,
    'child', child_gedcom_id,
    'family', family_gedcom_id,
    'removed_rows', deleted_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Add child to a family (idempotent)
CREATE OR REPLACE FUNCTION public.admin_link_child(
  child_gedcom_id TEXT,
  family_gedcom_id TEXT
)
RETURNS JSON AS $$
DECLARE
  child_uuid UUID;
  fam_uuid UUID;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT id INTO child_uuid FROM public.individuals WHERE gedcom_id = child_gedcom_id LIMIT 1;
  SELECT id INTO fam_uuid FROM public.families WHERE gedcom_id = family_gedcom_id LIMIT 1;

  IF child_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Child not found');
  END IF;
  IF fam_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Family not found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = fam_uuid AND individual_id = child_uuid AND role = 'child'
  ) THEN
    RETURN json_build_object('success', true, 'already_linked', true, 'child', child_gedcom_id, 'family', family_gedcom_id);
  END IF;

  INSERT INTO public.family_members (family_id, individual_id, role)
  VALUES (fam_uuid, child_uuid, 'child');

  RETURN json_build_object('success', true, 'already_linked', false, 'child', child_gedcom_id, 'family', family_gedcom_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Move child from one family to another (fixes wrong parents)
CREATE OR REPLACE FUNCTION public.admin_move_child(
  child_gedcom_id TEXT,
  from_family_gedcom_id TEXT,
  to_family_gedcom_id TEXT
)
RETURNS JSON AS $$
DECLARE
  unlink_result JSON;
  link_result JSON;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF from_family_gedcom_id IS NULL OR to_family_gedcom_id IS NULL
     OR from_family_gedcom_id = to_family_gedcom_id THEN
    RETURN json_build_object('success', false, 'error', 'from/to family IDs required and must differ');
  END IF;

  unlink_result := public.admin_unlink_child(child_gedcom_id, from_family_gedcom_id);
  IF (unlink_result->>'success')::boolean IS NOT TRUE THEN
    RETURN unlink_result;
  END IF;

  link_result := public.admin_link_child(child_gedcom_id, to_family_gedcom_id);
  IF (link_result->>'success')::boolean IS NOT TRUE THEN
    -- best-effort rollback
    PERFORM public.admin_link_child(child_gedcom_id, from_family_gedcom_id);
    RETURN link_result;
  END IF;

  RETURN json_build_object(
    'success', true,
    'child', child_gedcom_id,
    'from_family', from_family_gedcom_id,
    'to_family', to_family_gedcom_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Keep only one family link for a child (drop every other family)
CREATE OR REPLACE FUNCTION public.admin_keep_only_child_family(
  child_gedcom_id TEXT,
  keep_family_gedcom_id TEXT
)
RETURNS JSON AS $$
DECLARE
  child_uuid UUID;
  keep_uuid UUID;
  removed_count INT;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT id INTO child_uuid FROM public.individuals WHERE gedcom_id = child_gedcom_id LIMIT 1;
  SELECT id INTO keep_uuid FROM public.families WHERE gedcom_id = keep_family_gedcom_id LIMIT 1;

  IF child_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Child not found');
  END IF;
  IF keep_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Keep family not found');
  END IF;

  -- Ensure keep link exists
  INSERT INTO public.family_members (family_id, individual_id, role)
  SELECT keep_uuid, child_uuid, 'child'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.family_members
    WHERE family_id = keep_uuid AND individual_id = child_uuid AND role = 'child'
  );

  DELETE FROM public.family_members
  WHERE individual_id = child_uuid
    AND role = 'child'
    AND family_id <> keep_uuid;

  GET DIAGNOSTICS removed_count = ROW_COUNT;

  RETURN json_build_object(
    'success', true,
    'child', child_gedcom_id,
    'kept_family', keep_family_gedcom_id,
    'removed_other_links', removed_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Set / clear person notes
CREATE OR REPLACE FUNCTION public.admin_set_notes(
  target_gedcom_id TEXT,
  new_notes TEXT
)
RETURNS JSON AS $$
DECLARE
  updated_count INT;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  UPDATE public.individuals
  SET notes = NULLIF(new_notes, ''),
      updated_at = now()
  WHERE gedcom_id = target_gedcom_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Person not found');
  END IF;

  RETURN json_build_object('success', true, 'gedcom_id', target_gedcom_id);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Move notes from one person to another (optionally append + clear source)
CREATE OR REPLACE FUNCTION public.admin_move_notes(
  from_gedcom_id TEXT,
  to_gedcom_id TEXT,
  clear_source BOOLEAN DEFAULT true,
  append_if_target_has_notes BOOLEAN DEFAULT true
)
RETURNS JSON AS $$
DECLARE
  from_notes TEXT;
  to_notes TEXT;
  combined TEXT;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF from_gedcom_id IS NULL OR to_gedcom_id IS NULL OR from_gedcom_id = to_gedcom_id THEN
    RETURN json_build_object('success', false, 'error', 'Invalid from/to IDs');
  END IF;

  SELECT notes INTO from_notes FROM public.individuals WHERE gedcom_id = from_gedcom_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Source person not found');
  END IF;

  SELECT notes INTO to_notes FROM public.individuals WHERE gedcom_id = to_gedcom_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Target person not found');
  END IF;

  IF from_notes IS NULL OR trim(from_notes) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Source has no notes');
  END IF;

  IF to_notes IS NULL OR trim(to_notes) = '' THEN
    combined := from_notes;
  ELSIF append_if_target_has_notes THEN
    combined := to_notes || E'\n' || from_notes;
  ELSE
    RETURN json_build_object('success', false, 'error', 'Target already has notes; set append_if_target_has_notes=true or clear them first');
  END IF;

  UPDATE public.individuals
  SET notes = combined, updated_at = now()
  WHERE gedcom_id = to_gedcom_id;

  IF clear_source THEN
    UPDATE public.individuals
    SET notes = NULL, updated_at = now()
    WHERE gedcom_id = from_gedcom_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'from', from_gedcom_id,
    'to', to_gedcom_id,
    'cleared_source', clear_source
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Delete exact duplicate family_members rows (keeps one per family/person/role)
CREATE OR REPLACE FUNCTION public.admin_dedupe_family_members()
RETURNS JSON AS $$
DECLARE
  deleted_count INT;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  WITH ranked AS (
    SELECT ctid,
           row_number() OVER (
             PARTITION BY family_id, individual_id, role
             ORDER BY ctid
           ) AS rn
    FROM public.family_members
  )
  DELETE FROM public.family_members fm
  USING ranked r
  WHERE fm.ctid = r.ctid AND r.rn > 1;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN json_build_object('success', true, 'deleted_duplicate_rows', deleted_count);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Collapse every parallel parent-pair family group (keep the one with most children)
CREATE OR REPLACE FUNCTION public.admin_collapse_all_parallel_families()
RETURNS JSON AS $$
DECLARE
  dup RECORD;
  keep_family_gedcom TEXT;
  merge_family_gedcom TEXT;
  merged_count INT := 0;
  group_count INT := 0;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  FOR dup IN
    SELECT f.husband_id, f.wife_id
    FROM public.families f
    WHERE f.husband_id IS NOT NULL OR f.wife_id IS NOT NULL
    GROUP BY f.husband_id, f.wife_id
    HAVING COUNT(*) > 1
  LOOP
    group_count := group_count + 1;

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
      merged_count := merged_count + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'parallel_groups', group_count,
    'families_merged', merged_count
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Improve person merge: also combine notes before deleting merge target
CREATE OR REPLACE FUNCTION public.admin_merge_individuals(
  keep_gedcom_id TEXT,
  merge_gedcom_id TEXT
)
RETURNS JSON AS $$
DECLARE
  keep_uuid UUID;
  merge_uuid UUID;
  keep_notes TEXT;
  merge_notes TEXT;
  dup RECORD;
  keep_family_gedcom TEXT;
  merge_family_gedcom TEXT;
  merged_families INT := 0;
BEGIN
  IF NOT public.require_admin_or_sql() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF keep_gedcom_id IS NULL OR merge_gedcom_id IS NULL OR keep_gedcom_id = merge_gedcom_id THEN
    RETURN json_build_object('success', false, 'error', 'Invalid merge IDs');
  END IF;

  SELECT id, notes INTO keep_uuid, keep_notes
  FROM public.individuals WHERE gedcom_id = keep_gedcom_id LIMIT 1;
  SELECT id, notes INTO merge_uuid, merge_notes
  FROM public.individuals WHERE gedcom_id = merge_gedcom_id LIMIT 1;

  IF keep_uuid IS NULL OR merge_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'One or both individuals not found');
  END IF;

  -- Combine notes onto keep person
  IF merge_notes IS NOT NULL AND trim(merge_notes) <> '' THEN
    UPDATE public.individuals
    SET notes = CASE
          WHEN keep_notes IS NULL OR trim(keep_notes) = '' THEN merge_notes
          WHEN position(merge_notes IN keep_notes) > 0 THEN keep_notes
          ELSE keep_notes || E'\n' || merge_notes
        END,
        updated_at = now()
    WHERE id = keep_uuid;
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

-- ------------------------------------------------------------
-- 4) Grants
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.require_admin_or_sql() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_merge_families(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_integrity_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_multi_family_children() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_parallel_families() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_duplicate_people() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_duplicate_notes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_orphan_links() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_audit_child_parent_map(TEXT) TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_unlink_child(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_link_child(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_child(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_keep_only_child_family(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_notes(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_move_notes(TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dedupe_family_members() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_collapse_all_parallel_families() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_merge_individuals(TEXT, TEXT) TO authenticated;
