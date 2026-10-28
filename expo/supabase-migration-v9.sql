-- ============================================================
-- Tekna migration v9
-- Sync performance: indexes, RLS initplan fix, tree_meta watermark
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================

-- 1. Ensure updated_at columns exist (individuals already has them)
-- ============================================================
ALTER TABLE public.individuals
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Hot-path indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS individuals_gedcom_id_idx
  ON public.individuals (gedcom_id);

CREATE INDEX IF NOT EXISTS individuals_updated_at_idx
  ON public.individuals (updated_at DESC);

CREATE INDEX IF NOT EXISTS families_gedcom_id_idx
  ON public.families (gedcom_id);

CREATE INDEX IF NOT EXISTS families_updated_at_idx
  ON public.families (updated_at DESC);

CREATE INDEX IF NOT EXISTS families_husband_id_idx
  ON public.families (husband_id)
  WHERE husband_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS families_wife_id_idx
  ON public.families (wife_id)
  WHERE wife_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS family_members_family_id_idx
  ON public.family_members (family_id);

CREATE INDEX IF NOT EXISTS family_members_individual_id_idx
  ON public.family_members (individual_id);

CREATE INDEX IF NOT EXISTS family_members_family_role_idx
  ON public.family_members (family_id, role);

CREATE INDEX IF NOT EXISTS family_members_updated_at_idx
  ON public.family_members (updated_at DESC);

-- Unique indexes when data is clean (skipped if duplicates already exist)
DO $$
BEGIN
  CREATE UNIQUE INDEX individuals_gedcom_id_uidx ON public.individuals (gedcom_id);
EXCEPTION WHEN unique_violation OR duplicate_table THEN
  RAISE NOTICE 'individuals_gedcom_id_uidx skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX families_gedcom_id_uidx ON public.families (gedcom_id);
EXCEPTION WHEN unique_violation OR duplicate_table THEN
  RAISE NOTICE 'families_gedcom_id_uidx skipped: %', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX family_members_unique_role_uidx
    ON public.family_members (family_id, individual_id, role);
EXCEPTION WHEN unique_violation OR duplicate_table THEN
  RAISE NOTICE 'family_members_unique_role_uidx skipped (duplicates present): %', SQLERRM;
END $$;

-- 3. tree_meta — single-row watermark for cheap "anything new?" checks
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tree_meta (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data_version TIMESTAMPTZ NOT NULL DEFAULT now(),
  individual_count BIGINT NOT NULL DEFAULT 0,
  family_count BIGINT NOT NULL DEFAULT 0,
  member_count BIGINT NOT NULL DEFAULT 0
);

INSERT INTO public.tree_meta (id, data_version, individual_count, family_count, member_count)
VALUES (
  1,
  now(),
  (SELECT COUNT(*) FROM public.individuals),
  (SELECT COUNT(*) FROM public.families),
  (SELECT COUNT(*) FROM public.family_members)
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tree_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tree_meta_select_enabled" ON public.tree_meta;
CREATE POLICY "tree_meta_select_enabled" ON public.tree_meta
  FOR SELECT USING ((SELECT public.is_enabled()) OR (SELECT public.is_admin()));

-- Bump watermark + cached counts whenever genealogy data changes
CREATE OR REPLACE FUNCTION public.bump_tree_meta()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.tree_meta (id, data_version, individual_count, family_count, member_count)
  VALUES (
    1,
    now(),
    (SELECT COUNT(*) FROM public.individuals),
    (SELECT COUNT(*) FROM public.families),
    (SELECT COUNT(*) FROM public.family_members)
  )
  ON CONFLICT (id) DO UPDATE
    SET
      data_version = now(),
      individual_count = EXCLUDED.individual_count,
      family_count = EXCLUDED.family_count,
      member_count = EXCLUDED.member_count;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS individuals_bump_tree_meta ON public.individuals;
CREATE TRIGGER individuals_bump_tree_meta
  AFTER INSERT OR UPDATE OR DELETE ON public.individuals
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_tree_meta();

DROP TRIGGER IF EXISTS families_bump_tree_meta ON public.families;
CREATE TRIGGER families_bump_tree_meta
  AFTER INSERT OR UPDATE OR DELETE ON public.families
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_tree_meta();

DROP TRIGGER IF EXISTS family_members_bump_tree_meta ON public.family_members;
CREATE TRIGGER family_members_bump_tree_meta
  AFTER INSERT OR UPDATE OR DELETE ON public.family_members
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_tree_meta();

-- Keep row updated_at fresh on UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS individuals_set_updated_at ON public.individuals;
CREATE TRIGGER individuals_set_updated_at
  BEFORE UPDATE ON public.individuals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS families_set_updated_at ON public.families;
CREATE TRIGGER families_set_updated_at
  BEFORE UPDATE ON public.families
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS family_members_set_updated_at ON public.family_members;
CREATE TRIGGER family_members_set_updated_at
  BEFORE UPDATE ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed / refresh counts once after install
CREATE OR REPLACE FUNCTION public.refresh_tree_meta()
RETURNS JSON AS $$
BEGIN
  INSERT INTO public.tree_meta (id, data_version, individual_count, family_count, member_count)
  VALUES (
    1,
    now(),
    (SELECT COUNT(*) FROM public.individuals),
    (SELECT COUNT(*) FROM public.families),
    (SELECT COUNT(*) FROM public.family_members)
  )
  ON CONFLICT (id) DO UPDATE
    SET
      data_version = now(),
      individual_count = EXCLUDED.individual_count,
      family_count = EXCLUDED.family_count,
      member_count = EXCLUDED.member_count;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

SELECT public.refresh_tree_meta();

-- 4. RLS initplan fix — wrap helpers in (SELECT …) so Postgres evaluates once
-- ============================================================
DROP POLICY IF EXISTS "individuals_select_enabled" ON public.individuals;
CREATE POLICY "individuals_select_enabled" ON public.individuals
  FOR SELECT USING ((SELECT public.is_enabled()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "individuals_insert_admin" ON public.individuals;
CREATE POLICY "individuals_insert_admin" ON public.individuals
  FOR INSERT WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "individuals_update_admin" ON public.individuals;
CREATE POLICY "individuals_update_admin" ON public.individuals
  FOR UPDATE USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "individuals_delete_admin" ON public.individuals;
CREATE POLICY "individuals_delete_admin" ON public.individuals
  FOR DELETE USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "families_select_enabled" ON public.families;
CREATE POLICY "families_select_enabled" ON public.families
  FOR SELECT USING ((SELECT public.is_enabled()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "families_insert_admin" ON public.families;
CREATE POLICY "families_insert_admin" ON public.families
  FOR INSERT WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "families_update_admin" ON public.families;
CREATE POLICY "families_update_admin" ON public.families
  FOR UPDATE USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "families_delete_admin" ON public.families;
CREATE POLICY "families_delete_admin" ON public.families
  FOR DELETE USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "family_members_select_enabled" ON public.family_members;
CREATE POLICY "family_members_select_enabled" ON public.family_members
  FOR SELECT USING ((SELECT public.is_enabled()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "family_members_insert_admin" ON public.family_members;
CREATE POLICY "family_members_insert_admin" ON public.family_members
  FOR INSERT WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "family_members_update_admin" ON public.family_members;
CREATE POLICY "family_members_update_admin" ON public.family_members
  FOR UPDATE USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "family_members_delete_admin" ON public.family_members;
CREATE POLICY "family_members_delete_admin" ON public.family_members
  FOR DELETE USING ((SELECT public.is_admin()));

-- 5. Cheap RPCs for the app
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_tree_meta()
RETURNS JSON AS $$
DECLARE
  row public.tree_meta%ROWTYPE;
BEGIN
  IF NOT public.is_enabled() AND NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  SELECT * INTO row FROM public.tree_meta WHERE id = 1;
  IF NOT FOUND THEN
    PERFORM public.refresh_tree_meta();
    SELECT * INTO row FROM public.tree_meta WHERE id = 1;
  END IF;

  RETURN json_build_object(
    'success', true,
    'data_version', row.data_version,
    'individuals', row.individual_count,
    'families', row.family_count,
    'members', row.member_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_tree_counts()
RETURNS JSON AS $$
BEGIN
  RETURN public.get_tree_meta();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_tree_meta() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tree_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_tree_meta() TO authenticated;
GRANT SELECT ON public.tree_meta TO authenticated;

-- 6. get_next_gedcom_id — keep GREATEST(table_max, counter) so a stale
--    counter can never mint a duplicate ID (safe for current production app).
--    Indexes above make the MAX scan cheaper; behavior matches v8.
-- ============================================================
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

GRANT EXECUTE ON FUNCTION public.get_next_gedcom_id(TEXT) TO authenticated;

-- Done
-- After running: open the app and tap Profile → Refresh once so clients pick up tree_meta.
