import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';

const ONBOARDING_KEY = 'onboarding_completed';

export const [OnboardingProvider, useOnboarding] = createContextHook(() => {
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [onboardingChecked, setOnboardingChecked] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const finish = (value: string | null) => {
      if (cancelled) return;
      if (value !== 'true') {
        setShowOnboarding(true);
      }
      setOnboardingChecked(true);
    };

    // Web can hang on storage in some browsers; never block first paint forever.
    const timeout = setTimeout(() => finish(null), 1500);

    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((value) => {
        clearTimeout(timeout);
        finish(value);
      })
      .catch(() => {
        clearTimeout(timeout);
        finish(null);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  const replayTutorial = useCallback(() => {
    setShowOnboarding(true);
  }, []);

  const completeTutorial = useCallback(() => {
    setShowOnboarding(false);
    void AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  }, []);

  return useMemo(
    () => ({
      showOnboarding,
      onboardingChecked,
      replayTutorial,
      completeTutorial,
    }),
    [showOnboarding, onboardingChecked, replayTutorial, completeTutorial]
  );
});
