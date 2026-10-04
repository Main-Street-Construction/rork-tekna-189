import * as Linking from 'expo-linking';
import { supabase } from './supabase';

function paramsFromUrl(url: string): URLSearchParams {
  const params = new URLSearchParams();
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((value, key) => params.set(key, value));
    const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    if (hash) {
      new URLSearchParams(hash).forEach((value, key) => params.set(key, value));
    }
  } catch {
    const q = url.includes('?') ? url.split('?')[1]?.split('#')[0] : '';
    const h = url.includes('#') ? url.split('#')[1] : '';
    if (q) new URLSearchParams(q).forEach((value, key) => params.set(key, value));
    if (h) new URLSearchParams(h).forEach((value, key) => params.set(key, value));
  }
  return params;
}

export function isPasswordRecoveryUrl(url: string): boolean {
  const params = paramsFromUrl(url);
  const type = params.get('type');
  return (
    type === 'recovery' ||
    url.includes('/update-password') ||
    (!!params.get('access_token') && !!params.get('refresh_token'))
  );
}

/**
 * Establish a Supabase session from a password-reset / auth callback deep link.
 * Returns true when a recovery session was applied.
 */
export async function handleAuthDeepLink(url: string): Promise<{
  handled: boolean;
  recovery: boolean;
  error?: string;
}> {
  if (!url) return { handled: false, recovery: false };

  const params = paramsFromUrl(url);
  const type = params.get('type');
  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return { handled: true, recovery: type === 'recovery' || isPasswordRecoveryUrl(url), error: error.message };
      return { handled: true, recovery: type === 'recovery' || isPasswordRecoveryUrl(url) };
    }

    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) return { handled: true, recovery: type === 'recovery' || true, error: error.message };
      return { handled: true, recovery: type === 'recovery' || true };
    }
  } catch (e) {
    return {
      handled: true,
      recovery: isPasswordRecoveryUrl(url),
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return { handled: false, recovery: false };
}

export function getPasswordResetRedirectUrl(): string {
  return Linking.createURL('/update-password', { scheme: 'rork-app' });
}
