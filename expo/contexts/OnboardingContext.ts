import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';

const ONBOARDING_KEY = 'onboarding_completed';

export const [OnboardingProvider, useOnboarding] = createContextHook(() => {
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [onboardingChecked, setOnboardingChecked] = useState<boolean>(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((value) => {
        if (value !== 'true') {
          setShowOnboarding(true);
        }
        setOnboardingChecked(true);
      })
      .catch(() => {
        setOnboardingChecked(true);
      });
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
