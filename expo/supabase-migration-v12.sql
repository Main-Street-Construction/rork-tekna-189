-- v12: Fix ambiguous expo_push_token in push token RPCs
-- Parameter names collided with push_tokens.expo_push_token column.
-- Must DROP first — CREATE OR REPLACE cannot rename input parameters.

DROP FUNCTION IF EXISTS public.register_push_token(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.unregister_push_token(TEXT);

CREATE FUNCTION public.register_push_token(
  p_expo_push_token TEXT,
  p_platform TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  trimmed_token TEXT := trim(p_expo_push_token);
BEGIN
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF trimmed_token IS NULL OR length(trimmed_token) < 1 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid push token');
  END IF;

  INSERT INTO public.push_tokens (user_id, expo_push_token, platform, updated_at)
  VALUES (caller_id, trimmed_token, p_platform, now())
  ON CONFLICT (user_id, expo_push_token)
  DO UPDATE SET
    platform = EXCLUDED.platform,
    updated_at = now();

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE FUNCTION public.unregister_push_token(p_expo_push_token TEXT)
RETURNS JSON AS $$
DECLARE
  caller_id UUID := auth.uid();
  trimmed_token TEXT := trim(p_expo_push_token);
BEGIN
  IF caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  DELETE FROM public.push_tokens
  WHERE user_id = caller_id
    AND push_tokens.expo_push_token = trimmed_token;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO authenticated;
