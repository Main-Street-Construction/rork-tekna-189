import { Tabs } from 'expo-router';
import { Search, Clock, User, GitFork } from 'lucide-react-native';
import React, { useMemo } from 'react';
import { useColors, type ColorPalette } from '@/contexts/ThemeContext';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';

export default function TabLayout() {
  const Colors = useColors();

  const { isAdmin, pendingEditCount } = useFamilyTree();
  const badgeCount = isAdmin && pendingEditCount > 0 ? pendingEditCount.toString() : undefined;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textLight,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.tabBar,
          borderTopColor: Colors.cardBorder,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600' as const,
        },
      }}
    >
      <Tabs.Screen
        name="(search)"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }) => <Search size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="relationship"
        options={{
          title: 'Relations',
          tabBarIcon: ({ color, size }) => <GitFork size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <Clock size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
          tabBarBadge: badgeCount,
          tabBarBadgeStyle: badgeCount ? { backgroundColor: Colors.accent, fontSize: 10, fontWeight: '700' as const } : undefined,
        }}
      />
    </Tabs>
  );
}
