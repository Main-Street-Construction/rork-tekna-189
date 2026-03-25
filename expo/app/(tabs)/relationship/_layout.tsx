import { Stack } from 'expo-router';
import React from 'react';
import Colors from '@/constants/colors';

export default function RelationshipLayout() {
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
        options={{ title: 'Relationship Calculator' }}
      />
    </Stack>
  );
}
