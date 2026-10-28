-- ============================================================
-- Tekna migration v10
-- Server-side notify on new access requests (no client dependency)
-- Run in Supabase SQL Editor (safe to re-run)
-- ============================================================

-- 1. pg_net for async HTTP from triggers
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Fire edge function whenever a pending access request appears
--    notify-admins-access-request has verify_jwt=false, so no key needed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trigger_notify_access_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  edge_url TEXT;
  should_fire BOOLEAN := false;
BEGIN
  IF NEW.is_enabled IS TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    should_fire := true;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Newly flagged request, or re-disabled account
    IF NEW.access_requested_at IS NOT NULL
       AND (OLD.access_requested_at IS NULL OR OLD.access_requested_at IS DISTINCT FROM NEW.access_requested_at)
    THEN
      should_fire := true;
    ELSIF OLD.is_enabled IS TRUE AND NEW.is_enabled IS FALSE THEN
      should_fire := true;
    END IF;
  END IF;

  IF NOT should_fire THEN
    RETURN NEW;
  END IF;

  edge_url := rtrim(
    coalesce(
      nullif(current_setting('app.settings.supabase_url', true), ''),
      'https://qbblvhvyzirakazfvnrs.supabase.co'
    ),
    '/'
  ) || '/functions/v1/notify-admins-access-request';

  BEGIN
    PERFORM net.http_post(
      url := edge_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'user_id', NEW.id::text,
        'source', 'db_trigger'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trigger_notify_access_request failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_notify_access_request ON public.profiles;
CREATE TRIGGER profiles_notify_access_request
  AFTER INSERT OR UPDATE OF is_enabled, access_requested_at ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_notify_access_request();

-- 3. Ensure new signups always stamp access_requested_at (webhook fuel)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  meta_name TEXT := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '');
BEGIN
  INSERT INTO public.profiles (id, is_enabled, is_admin, full_name, access_requested_at)
  VALUES (
    NEW.id,
    false,
    false,
    meta_name,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET
      full_name = COALESCE(NULLIF(trim(public.profiles.full_name), ''), EXCLUDED.full_name),
      access_requested_at = COALESCE(public.profiles.access_requested_at, EXCLUDED.access_requested_at);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user trigger failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Optional: also wire a Dashboard Database Webhook on public.profiles
-- (INSERT + UPDATE) → POST /functions/v1/notify-admins-access-request
-- as a second path. The edge function accepts both payload shapes.

-- 4. Realtime so the Admin screen updates without pull-to-refresh
-- ============================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication missing — enable Realtime for profiles in Dashboard';
END $$;
