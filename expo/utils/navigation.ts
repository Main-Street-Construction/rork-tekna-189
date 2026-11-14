/**
 * Prefer dismiss (works for modals + stacked screens), then back, then a safe fallback.
 * Avoid replace unless there is truly nowhere to go — replace wipes useful history.
 */
type BackCapableRouter = {
  canDismiss?: () => boolean;
  dismiss: (count?: number) => void;
  dismissAll?: () => void;
  dismissTo?: (href: '/(tabs)/(search)' | '/(tabs)/profile') => void;
  canGoBack: () => boolean;
  back: () => void;
  replace?: (href: '/(tabs)/(search)' | '/(tabs)/profile') => void;
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

/** Jump to Search tab and clear any person/modal stack above tabs. */
export function navigateHome(router: BackCapableRouter) {
  const home: '/(tabs)/(search)' = '/(tabs)/(search)';

  try {
    if (typeof router.dismissTo === 'function') {
      router.dismissTo(home);
      return;
    }
  } catch {
    // fall through
  }

  try {
    if (typeof router.dismissAll === 'function' && typeof router.canDismiss === 'function' && router.canDismiss()) {
      router.dismissAll();
    }
  } catch {
    // fall through
  }

  try {
    if (typeof router.replace === 'function') {
      router.replace(home);
      return;
    }
  } catch {
    // fall through
  }

  router.navigate(home);
}

export const modalScreenOptions = {
  headerBackVisible: false,
  headerShadowVisible: false,
  gestureEnabled: true,
} as const;
