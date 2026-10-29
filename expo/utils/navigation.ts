/**
 * Prefer dismiss (works for modals + stacked screens), then back, then a safe fallback.
 * Avoid replace unless there is truly nowhere to go — replace wipes useful history.
 */
type BackCapableRouter = {
  canDismiss?: () => boolean;
  dismiss: (count?: number) => void;
  canGoBack: () => boolean;
  back: () => void;
  navigate: (href: '/(tabs)/(search)' | '/(tabs)/profile') => void;
};

export function navigateBack(
  router: BackCapableRouter,
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
