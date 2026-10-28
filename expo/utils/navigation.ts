import type { Router } from 'expo-router';

/**
 * Prefer dismiss (works for modals + stacked screens), then back, then a safe fallback.
 * Avoid replace unless there is truly nowhere to go — replace wipes useful history.
 */
export function navigateBack(
  router: Router,
  fallbackRoute: '/(tabs)/(search)' | '/(tabs)/profile' = '/(tabs)/(search)'
) {
  try {
    if (typeof router.canDismiss === 'function' && router.canDismiss()) {
      router.dismiss();
      return;
    }
  } catch {
    // ignore — fall through
  }

  try {
    if (router.canGoBack()) {
      router.back();
      return;
    }
  } catch {
    // ignore — fall through
  }

  router.navigate(fallbackRoute);
}

export const modalScreenOptions = {
  headerBackVisible: false,
  headerShadowVisible: false,
  gestureEnabled: true,
} as const;
