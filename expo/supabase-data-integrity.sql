-- ============================================================
-- Tekna data integrity — audit + fix cookbook
-- ============================================================
-- Prerequisites
--   1. Run expo/supabase-migration-v13.sql once in the SQL Editor
--   2. Run expo/supabase-migration-v13b-gedcom-id-dupes.sql
--      (true-dupe audits + fix ID allocator so Tekna won't recycle
--       numbers past existing @I###@ rows)
--   3. Run expo/supabase-migration-v13c-duplicate-sibling-guard.sql
--      (blocks linking a second child with same name+birth into the
--       same family; SQL override for intentional twins below)
--   4. Then run audits/fixes below in the same SQL Editor
--      (no JWT needed there; app callers still must be admins)
--
-- Intentional twins (same name + birth in one family):
--   SELECT set_config('tekna.allow_duplicate_sibling', 'on', true);
--   -- then insert/link the second twin in the same session
--
-- IMPORTANT about IDs
--   Bare I123  = Tekna-created (or normalized) person
--   @I123@     = GEDCOM-imported person
--   Same number does NOT mean same person. Never bulk-merge on ID.
--
-- Safe order of operations
--   A. Audit summary + export detail lists
--   B. admin_dedupe_family_members()          (safe auto)
--   C. admin_collapse_all_parallel_families() (safe auto)
--   D. Fix wrong parents with unlink/move/keep_only
--   E. Review likely TRUE duplicates, merge one pair at a time
--   F. Move / clear wrong notes
--   G. Re-run audit summary and confirm counts dropped
-- ============================================================

-- ------------------------------------------------------------
-- A) AUDIT
-- ------------------------------------------------------------

-- Quick counts
SELECT public.admin_audit_integrity_summary();

-- Kids linked to more than one family (main "wrong parents" smell)
SELECT * FROM public.admin_audit_multi_family_children();

-- Same two parents, multiple family rows
SELECT * FROM public.admin_audit_parallel_families();

-- BEST: name+birth matches that also share a spouse, parent family, or child
SELECT * FROM public.admin_audit_likely_true_duplicates();

-- Weaker: same first+last+birth (includes @I vs bare collisions — review carefully)
SELECT * FROM public.admin_audit_duplicate_people_strong();

-- ID-namespace collisions only (informational — these are usually DIFFERENT people)
SELECT * FROM public.admin_audit_gedcom_id_collisions();

-- Exact same note text on multiple people
SELECT * FROM public.admin_audit_duplicate_notes();

-- Broken FKs / orphan membership rows
SELECT * FROM public.admin_audit_orphan_links();

-- Full child → parents map (optional filter)
-- SELECT * FROM public.admin_audit_child_parent_map(NULL);
-- SELECT * FROM public.admin_audit_child_parent_map('I123');

-- ------------------------------------------------------------
-- B–C) SAFE AUTO-FIXES
-- ------------------------------------------------------------

-- Remove exact duplicate family_members rows
-- SELECT public.admin_dedupe_family_members();

-- Collapse parallel families that share the same husband/wife pair
-- (keeps the family with the most children)
-- SELECT public.admin_collapse_all_parallel_families();

-- ------------------------------------------------------------
-- D) FIX WRONG PARENT LINKS (edit IDs, then uncomment)
-- ------------------------------------------------------------

-- See current parents for one child:
-- SELECT * FROM public.admin_audit_child_parent_map('I_CHILD');

-- Remove child from the WRONG family only:
-- SELECT public.admin_unlink_child('I_CHILD', 'F_WRONG');

-- Move child from wrong family to correct family:
-- SELECT public.admin_move_child('I_CHILD', 'F_WRONG', 'F_CORRECT');

-- Keep one family and drop every other parent link for that child:
-- SELECT public.admin_keep_only_child_family('I_CHILD', 'F_CORRECT');

-- Add a missing child link (without removing others):
-- SELECT public.admin_link_child('I_CHILD', 'F_CORRECT');

-- ------------------------------------------------------------
-- E) MERGE DUPLICATE PEOPLE (evidence-backed pairs)
-- ------------------------------------------------------------
-- Only merge after admin_audit_likely_true_duplicates() shows shared
-- family evidence. Prefer keeping the richer record (more links / notes).
--
-- DO NOT merge intentional twins. From the Nov 2026 audit, skip:
--   Twin Son Angle  @I11018@ / @I11019@  (shared parents — expected for twins)
--
-- 1) Preview keep/drop (richer record wins; Twin Son excluded)
WITH candidates AS (
  SELECT *
  FROM public.admin_audit_likely_true_duplicates()
  WHERE NOT (first_name_norm = 'twin son' AND last_name_norm = 'angle')
),
ids AS (
  SELECT c.first_name_norm, c.last_name_norm, c.birth_date,
         unnest(c.gedcom_ids) AS gid
  FROM candidates c
),
scored AS (
  SELECT
    i.*,
    (
      SELECT count(*)::INT
      FROM public.family_members fm
      JOIN public.individuals ind ON ind.id = fm.individual_id
      WHERE ind.gedcom_id = i.gid
    ) AS link_count,
    length(coalesce(
      (SELECT notes FROM public.individuals WHERE gedcom_id = i.gid), ''
    )) AS notes_len
  FROM ids i
),
ranked AS (
  SELECT *,
    row_number() OVER (
      PARTITION BY first_name_norm, last_name_norm, birth_date
      ORDER BY link_count DESC, notes_len DESC, gid
    ) AS rn
  FROM scored
)
SELECT
  k.first_name_norm,
  k.last_name_norm,
  k.birth_date,
  k.gid AS keep_id,
  d.gid AS drop_id,
  k.link_count AS keep_links,
  d.link_count AS drop_links
FROM ranked k
JOIN ranked d
  ON k.first_name_norm = d.first_name_norm
 AND k.last_name_norm = d.last_name_norm
 AND k.birth_date IS NOT DISTINCT FROM d.birth_date
 AND k.rn = 1 AND d.rn = 2
ORDER BY k.last_name_norm, k.first_name_norm;

-- 2) Merge all evidence-backed pairs except Twin Son
--    (run AFTER reviewing the preview above)
/*
DO $$
DECLARE
  r RECORD;
  result JSON;
BEGIN
  FOR r IN
    WITH candidates AS (
      SELECT *
      FROM public.admin_audit_likely_true_duplicates()
      WHERE NOT (first_name_norm = 'twin son' AND last_name_norm = 'angle')
    ),
    ids AS (
      SELECT c.first_name_norm, c.last_name_norm, c.birth_date,
             unnest(c.gedcom_ids) AS gid
      FROM candidates c
    ),
    scored AS (
      SELECT
        i.*,
        (
          SELECT count(*)::INT
          FROM public.family_members fm
          JOIN public.individuals ind ON ind.id = fm.individual_id
          WHERE ind.gedcom_id = i.gid
        ) AS link_count,
        length(coalesce(
          (SELECT notes FROM public.individuals WHERE gedcom_id = i.gid), ''
        )) AS notes_len
      FROM ids i
    ),
    ranked AS (
      SELECT *,
        row_number() OVER (
          PARTITION BY first_name_norm, last_name_norm, birth_date
          ORDER BY link_count DESC, notes_len DESC, gid
        ) AS rn
      FROM scored
    )
    SELECT
      k.gid AS keep_id,
      d.gid AS drop_id,
      k.first_name_norm,
      k.last_name_norm
    FROM ranked k
    JOIN ranked d
      ON k.first_name_norm = d.first_name_norm
     AND k.last_name_norm = d.last_name_norm
     AND k.birth_date IS NOT DISTINCT FROM d.birth_date
     AND k.rn = 1 AND d.rn = 2
  LOOP
    result := public.admin_merge_individuals(r.keep_id, r.drop_id);
    RAISE NOTICE '% % → kept % dropped % :: %',
      r.first_name_norm, r.last_name_norm, r.keep_id, r.drop_id, result;
  END LOOP;
END $$;
*/

-- Single pair (edit IDs):
-- SELECT public.admin_merge_individuals('I_KEEP', 'I_DROP');
-- SELECT public.admin_merge_families('F_KEEP', 'F_DROP');

-- ------------------------------------------------------------
-- F) NOTES
-- ------------------------------------------------------------

-- Replace / clear notes on a person (use '' to clear):
-- SELECT public.admin_set_notes('I123', 'Correct note text here');
-- SELECT public.admin_set_notes('I123', '');

-- Move notes from wrong person onto the right one (clears source):
-- SELECT public.admin_move_notes('I_WRONG', 'I_RIGHT', true, true);

-- ------------------------------------------------------------
-- G) RE-AUDIT
-- ------------------------------------------------------------

-- SELECT public.admin_audit_integrity_summary();
-- SELECT * FROM public.admin_audit_multi_family_children();
-- SELECT * FROM public.admin_audit_likely_true_duplicates();
