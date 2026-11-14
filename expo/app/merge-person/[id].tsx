import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Keyboard,
  ScrollView,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import { X, Search, GitMerge } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useColors, type ColorPalette } from '@/contexts/ThemeContext';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { GedcomIndividual } from '@/types/genealogy';
import { modalScreenOptions } from '@/utils/navigation';
import ModalCloseButton from '@/components/ModalCloseButton';

function personSnapshot(p: GedcomIndividual) {
  return {
    id: p.id,
    name: p.name,
    givenName: p.givenName,
    surname: p.surname,
    sex: p.sex,
    birthDate: p.birthDate,
    birthPlace: p.birthPlace,
    deathDate: p.deathDate,
    deathPlace: p.deathPlace,
    occupation: p.occupation,
    note: p.note,
  };
}

export default function MergePersonScreen() {
  const Colors = useColors();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    search,
    getPerson,
    isAdmin,
    submitEdit,
    mergeIndividualsInTree,
    resolvePerson,
    isReady,
    isLoadingFromCloud,
  } = useFamilyTree();

  const [keep, setKeep] = useState<GedcomIndividual | null>(null);
  const [duplicate, setDuplicate] = useState<GedcomIndividual | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GedcomIndividual[]>([]);
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id || !isReady) return;
    const local = getPerson(id);
    if (local) {
      setKeep(local);
      return;
    }
    let cancelled = false;
    setIsResolving(true);
    void resolvePerson(id).then((fetched) => {
      if (!cancelled && fetched) setKeep(fetched);
    }).finally(() => {
      if (!cancelled) setIsResolving(false);
    });
    return () => { cancelled = true; };
  }, [id, isReady, getPerson, resolvePerson]);

  const handleSearch = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (text.trim().length >= 2) {
        searchTimerRef.current = setTimeout(() => {
          const found = search(text).filter((p) => p.id !== id);
          setSearchResults(found.slice(0, 30));
        }, 250);
      } else {
        setSearchResults([]);
      }
    },
    [search, id]
  );

  const swapKeepMerge = useCallback(() => {
    if (!keep || !duplicate) return;
    setKeep(duplicate);
    setDuplicate(keep);
    Haptics.selectionAsync();
  }, [keep, duplicate]);

  const handleSave = useCallback(async () => {
    if (!keep || !duplicate) return;
    if (keep.id === duplicate.id) {
      Alert.alert('Invalid', 'Cannot merge a person with themselves.');
      return;
    }

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const payload = {
      keepId: keep.id,
      mergeId: duplicate.id,
      keepPerson: personSnapshot(keep),
      mergePerson: personSnapshot(duplicate),
      keepName: keep.name,
      mergeName: duplicate.name,
      reason: reason.trim() || undefined,
      note: reason.trim() || undefined,
    };

    try {
      if (isAdmin) {
        Alert.alert(
          'Merge People',
          `Keep "${keep.name}" and merge "${duplicate.name}" into it? Parallel families with the same parents will also be collapsed.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setIsSaving(false) },
            {
              text: 'Merge',
              style: 'destructive',
              onPress: async () => {
                const result = await mergeIndividualsInTree(keep.id, duplicate.id);
                setIsSaving(false);
                if (result.success) {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert('Merged', 'Duplicate person merged.', [
                    { text: 'OK', onPress: () => router.replace(`/person/${keep.id}`) },
                  ]);
                } else {
                  Alert.alert('Error', result.error ?? 'Failed to merge.');
                }
              },
            },
          ]
        );
        return;
      }

      const result = await submitEdit('merge_people', keep.id, payload);
      if (result.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Submitted', 'Merge request sent for admin review.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Error', result.error ?? 'Failed to submit.');
      }
    } catch {
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setIsSaving(false);
    }
  }, [keep, duplicate, reason, isAdmin, mergeIndividualsInTree, submitEdit, router]);

  const canSave = Boolean(keep && duplicate);

  if ((!isReady || isLoadingFromCloud || isResolving) && !keep) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Merge People' }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </View>
    );
  }

  if (!keep) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>Person not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          ...modalScreenOptions,
          title: isAdmin ? 'Merge People' : 'Suggest Merge',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerLeft: () => <ModalCloseButton />,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => void handleSave()}
              disabled={!canSave || isSaving}
              style={[styles.saveBtn, (!canSave || isSaving) && { opacity: 0.5 }]}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.saveBtnText}>{isAdmin ? 'Merge' : 'Submit'}</Text>
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.slot}>
            <Text style={styles.slotLabel}>Keep (primary)</Text>
            <Text style={styles.slotName}>{keep.name}</Text>
            {keep.birthDate ? <Text style={styles.slotMeta}>b. {keep.birthDate}</Text> : null}
          </View>

          {duplicate ? (
            <View style={styles.slot}>
              <View style={styles.slotHeader}>
                <Text style={styles.slotLabel}>Merge away (duplicate)</Text>
                <TouchableOpacity onPress={() => setDuplicate(null)}>
                  <X size={16} color={Colors.textLight} />
                </TouchableOpacity>
              </View>
              <Text style={styles.slotName}>{duplicate.name}</Text>
              {duplicate.birthDate ? <Text style={styles.slotMeta}>b. {duplicate.birthDate}</Text> : null}
              <TouchableOpacity style={styles.swapBtn} onPress={swapKeepMerge}>
                <GitMerge size={14} color={Colors.accent} />
                <Text style={styles.swapText}>Swap keep / merge</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.searchBar}>
                <Search size={18} color={Colors.textLight} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search for duplicate person..."
                  placeholderTextColor={Colors.textLight}
                  value={searchQuery}
                  onChangeText={handleSearch}
                  autoCorrect={false}
                />
              </View>
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.resultItem}
                    onPress={() => {
                      setDuplicate(item);
                      Keyboard.dismiss();
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                  >
                    <Text style={styles.resultName}>{item.name}</Text>
                    {item.birthDate ? <Text style={styles.resultMeta}>b. {item.birthDate}</Text> : null}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>
                    {searchQuery.length >= 2 ? 'No results found' : 'Search for the duplicate to merge into the primary person'}
                  </Text>
                }
              />
            </>
          )}

          {duplicate ? (
            <View style={styles.reasonSection}>
              <Text style={styles.slotLabel}>Reason (optional)</Text>
              <TextInput
                style={styles.reasonInput}
                value={reason}
                onChangeText={setReason}
                placeholder="Why are these the same person?"
                placeholderTextColor={Colors.textLight}
                multiline
              />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function createStyles(Colors: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingBottom: 40 },
  saveBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    marginRight: 8,
  },
  saveBtnText: { color: Colors.white, fontWeight: '600' as const },
  slot: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  slotHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  slotLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const },
  slotName: { fontSize: 16, fontWeight: '600' as const, color: Colors.text, marginTop: 6 },
  slotMeta: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  swapBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  swapText: { fontSize: 13, fontWeight: '600' as const, color: Colors.accent },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: Colors.text },
  resultItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  resultName: { fontSize: 15, color: Colors.text, fontWeight: '500' as const },
  resultMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  emptyText: { textAlign: 'center', color: Colors.textSecondary, marginTop: 24, paddingHorizontal: 16 },
  reasonSection: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  reasonInput: {
    marginTop: 8,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: Colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
});
}
