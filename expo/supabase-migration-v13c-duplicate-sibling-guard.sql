-- ============================================================
-- v13c — Prevent double-confirm duplicate children (DB-side)
-- ============================================================
-- Blocks linking a person as a child of a family when that family
-- already has a child with the same first name + last name + birth
-- date (normalized). This stops accidental "Create Anyway" / double
-- save duplicates without merging on ID.
--
-- Intentional twins with identical name + birth: allow in SQL Editor:
--   SELECT set_config('tekna.allow_duplicate_sibling', 'on', true);
--   -- then insert/link the second twin
--
-- Safe to re-run. Run after v13b.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_prevent_duplicate_sibling()
RETURNS TRIGGER AS $$
DECLARE
  new_first TEXT;
  new_last TEXT;
  new_birth TEXT;
  conflict_gedcom TEXT;
BEGIN
  IF NEW.role IS DISTINCT FROM 'child' THEN
    RETURN NEW;
  END IF;

  -- SQL Editor / admin override for intentional twins
  IF lower(coalesce(current_setting('tekna.allow_duplicate_sibling', true), '')) IN ('on', 'true', '1') THEN
    RETURN NEW;
  END IF;

  SELECT
    lower(trim(coalesce(i.first_name, ''))),
    lower(trim(coalesce(i.last_name, ''))),
    nullif(trim(coalesce(i.birth_date, '')), '')
  INTO new_first, new_last, new_birth
  FROM public.individuals i
  WHERE i.id = NEW.individual_id;

  -- Only enforce when we have a real name + birth (blank BD twins/placeholders OK)
  IF new_first IS NULL OR new_first = '' OR new_last IS NULL OR new_last = '' OR new_birth IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sib.gedcom_id INTO conflict_gedcom
  FROM public.family_members fm
  JOIN public.individuals sib ON sib.id = fm.individual_id
  WHERE fm.family_id = NEW.family_id
    AND fm.role = 'child'
    AND fm.individual_id IS DISTINCT FROM NEW.individual_id
    AND lower(trim(coalesce(sib.first_name, ''))) = new_first
    AND lower(trim(coalesce(sib.last_name, ''))) = new_last
    AND nullif(trim(coalesce(sib.birth_date, '')), '') IS NOT DISTINCT FROM new_birth
  LIMIT 1;

  IF conflict_gedcom IS NOT NULL THEN
    RAISE EXCEPTION
      'Duplicate sibling blocked: a child with the same name and birth date already exists in this family (%). For intentional twins, run: SELECT set_config(''tekna.allow_duplicate_sibling'', ''on'', true);',
      conflict_gedcom
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS family_members_prevent_duplicate_sibling ON public.family_members;
CREATE TRIGGER family_members_prevent_duplicate_sibling
  BEFORE INSERT ON public.family_members
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_prevent_duplicate_sibling();
