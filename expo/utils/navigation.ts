import type { Router } from 'expo-router';

export function navigateBack(router: Router, fallbackRoute: '/(tabs)/(search)' | '/(tabs)/profile' = '/(tabs)/(search)') {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallbackRoute);
}

export const modalScreenOptions = {
  headerBackVisible: false,
  headerShadowVisible: false,
} as const;
