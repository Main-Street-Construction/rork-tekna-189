-- ============================================================
-- Tekna migration v11
-- Soft name search: token AND, any order, middle names, typos
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- Shared: every query token must match somewhere in the name/id.
-- Tokens are order-independent so "Smith John" and "John Michael Smith" both work.
-- pg_trgm similarity covers light misspellings.

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
  q TEXT := lower(trim(both FROM regexp_replace(COALESCE(search_query, ''), '[[:punct:]]+', ' ', 'g')));
  lim INT := LEAST(GREATEST(COALESCE(result_limit, 30), 1), 100);
  tokens TEXT[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: caller is not an admin';
  END IF;

  IF q IS NULL OR length(q) < 1 THEN
    RETURN;
  END IF;

  tokens := ARRAY(
    SELECT t
    FROM unnest(regexp_split_to_array(q, '\s+')) AS t
    WHERE length(t) > 0
  );

  IF coalesce(array_length(tokens, 1), 0) = 0 THEN
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
    WHERE (
      SELECT bool_and(
        lower(COALESCE(i.gedcom_id, '')) LIKE '%' || tok || '%'
        OR lower(COALESCE(i.first_name, '')) LIKE '%' || tok || '%'
        OR lower(COALESCE(i.last_name, '')) LIKE '%' || tok || '%'
        OR lower(concat_ws(' ', i.first_name, i.last_name)) LIKE '%' || tok || '%'
        OR COALESCE(extensions.similarity(lower(COALESCE(i.first_name, '')), tok), 0) > 0.35
        OR COALESCE(extensions.similarity(lower(COALESCE(i.last_name, '')), tok), 0) > 0.35
        OR EXISTS (
          SELECT 1
          FROM unnest(
            regexp_split_to_array(
              lower(concat_ws(' ', i.first_name, i.last_name)),
              '\s+'
            )
          ) AS name_tok
          WHERE length(name_tok) > 0
            AND (
              name_tok LIKE tok || '%'
              OR tok LIKE name_tok || '%'
              OR COALESCE(extensions.similarity(name_tok, tok), 0) > 0.4
            )
        )
      )
      FROM unnest(tokens) AS tok
    )
    ORDER BY
      CASE
        WHEN lower(COALESCE(i.last_name, '')) = tokens[array_length(tokens, 1)] THEN 0
        WHEN lower(COALESCE(i.last_name, '')) LIKE tokens[array_length(tokens, 1)] || '%' THEN 1
        ELSE 2
      END,
      i.last_name NULLS LAST,
      i.first_name NULLS LAST
    LIMIT lim;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

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
  q TEXT := lower(trim(both FROM regexp_replace(COALESCE(search_query, ''), '[[:punct:]]+', ' ', 'g')));
  lim INT := LEAST(GREATEST(COALESCE(result_limit, 50), 1), 100);
  tokens TEXT[];
BEGIN
  IF NOT public.is_enabled() THEN
    RAISE EXCEPTION 'Forbidden: user is not enabled';
  END IF;

  IF q IS NULL OR length(q) < 1 THEN
    RETURN;
  END IF;

  tokens := ARRAY(
    SELECT t
    FROM unnest(regexp_split_to_array(q, '\s+')) AS t
    WHERE length(t) > 0
  );

  IF coalesce(array_length(tokens, 1), 0) = 0 THEN
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
    WHERE (
      SELECT bool_and(
        lower(COALESCE(i.gedcom_id, '')) LIKE '%' || tok || '%'
        OR lower(COALESCE(i.first_name, '')) LIKE '%' || tok || '%'
        OR lower(COALESCE(i.last_name, '')) LIKE '%' || tok || '%'
        OR lower(concat_ws(' ', i.first_name, i.last_name)) LIKE '%' || tok || '%'
        OR COALESCE(extensions.similarity(lower(COALESCE(i.first_name, '')), tok), 0) > 0.35
        OR COALESCE(extensions.similarity(lower(COALESCE(i.last_name, '')), tok), 0) > 0.35
        OR EXISTS (
          SELECT 1
          FROM unnest(
            regexp_split_to_array(
              lower(concat_ws(' ', i.first_name, i.last_name)),
              '\s+'
            )
          ) AS name_tok
          WHERE length(name_tok) > 0
            AND (
              name_tok LIKE tok || '%'
              OR tok LIKE name_tok || '%'
              OR COALESCE(extensions.similarity(name_tok, tok), 0) > 0.4
            )
        )
      )
      FROM unnest(tokens) AS tok
    )
    ORDER BY
      CASE
        WHEN lower(COALESCE(i.last_name, '')) = tokens[array_length(tokens, 1)] THEN 0
        WHEN lower(COALESCE(i.last_name, '')) LIKE tokens[array_length(tokens, 1)] || '%' THEN 1
        ELSE 2
      END,
      i.last_name NULLS LAST,
      i.first_name NULLS LAST
    LIMIT lim;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
