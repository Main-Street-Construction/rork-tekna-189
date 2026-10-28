import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ArrowLeft, User } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import TreeExplorerCanvas from '@/components/TreeExplorerCanvas';
import { navigateBack } from '@/utils/navigation';
import type { GedcomIndividual } from '@/types/genealogy';

export default function TreeExplorerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { treeData, getPerson, isReady } = useFamilyTree();

  const person = useMemo(() => (id ? getPerson(id) : undefined), [id, getPerson]);

  const handleOpenPerson = useCallback(
    (p: GedcomIndividual) => {
      router.push(`/person/${p.id}`);
    },
    [router]
  );

  const handleBack = useCallback(() => {
    navigateBack(router);
  }, [router]);

  const title = person?.name ?? 'Family Tree';

  return (
    <GestureHandlerRootView style={styles.root}>
      <Stack.Screen
        options={{
          title: 'Tree Explorer',
          headerShown: false,
          gestureEnabled: true,
        }}
      />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 10) }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.headerBtn}
          hitSlop={12}
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={22} color={Colors.accent} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Explore connections
          </Text>
        </View>
        {person ? (
          <TouchableOpacity
            onPress={() => router.push(`/person/${person.id}`)}
            style={styles.headerBtn}
            hitSlop={12}
            accessibilityLabel="Open profile"
          >
            <User size={20} color={Colors.accent} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {!isReady || !treeData ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
          <Text style={styles.muted}>Loading tree…</Text>
        </View>
      ) : !id || !person ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Person not found in the local tree.</Text>
          <TouchableOpacity style={styles.backLink} onPress={handleBack}>
            <Text style={styles.backLinkText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TreeExplorerCanvas
          focusId={id}
          data={treeData}
          onOpenPerson={handleOpenPerson}
        />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: Colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
    zIndex: 2,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  muted: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  backLink: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  backLinkText: {
    color: Colors.accent,
    fontWeight: '600',
    fontSize: 15,
  },
});
