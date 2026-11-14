import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorPalette, darkColors, lightColors } from '@/constants/colors';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';

const STORAGE_KEY = 'theme_preference';

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  scheme: ColorScheme;
  colors: ColorPalette;
};

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  setPreference: () => undefined,
  scheme: 'light',
  colors: lightColors,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && (stored === 'system' || stored === 'light' || stored === 'dark')) {
          setPreferenceState(stored);
        }
      } catch {
        // keep default
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    void AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => undefined);
  }, []);

  const scheme: ColorScheme = useMemo(() => {
    if (preference === 'light' || preference === 'dark') return preference;
    return systemScheme === 'dark' ? 'dark' : 'light';
  }, [preference, systemScheme]);

  const colors = scheme === 'dark' ? darkColors : lightColors;

  const value = useMemo(
    () => ({ preference, setPreference, scheme, colors }),
    [preference, setPreference, scheme, colors]
  );

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function useColors(): ColorPalette {
  return useContext(ThemeContext).colors;
}

/** Build StyleSheet (or style map) from the active palette; recomputes when theme changes. */
export function useThemedStyles<T>(factory: (colors: ColorPalette) => T): T {
  const colors = useColors();
  return useMemo(() => factory(colors), [colors, factory]);
}

export type { ColorPalette };
