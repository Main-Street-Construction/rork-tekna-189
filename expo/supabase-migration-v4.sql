-- Tekna migration v4: batch notes backfill for large databases
-- Run in Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.admin_backfill_notes(notes_payload JSONB)
RETURNS JSON AS $$
DECLARE
  updated_count INT;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN json_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF notes_payload IS NULL OR jsonb_typeof(notes_payload) <> 'object' THEN
    RETURN json_build_object('success', false, 'error', 'Invalid payload');
  END IF;

  WITH incoming AS (
    SELECT key AS gedcom_id, value AS notes
    FROM jsonb_each_text(notes_payload)
  )
  UPDATE public.individuals AS i
  SET notes = incoming.notes, updated_at = now()
  FROM incoming
  WHERE i.gedcom_id = incoming.gedcom_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN json_build_object('success', true, 'updated', updated_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
