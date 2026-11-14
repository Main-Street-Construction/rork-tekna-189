import { Stack } from 'expo-router';
import React, { useMemo } from 'react';
import { useColors, type ColorPalette } from '@/contexts/ThemeContext';

export default function SearchLayout() {
  const Colors = useColors();

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}
