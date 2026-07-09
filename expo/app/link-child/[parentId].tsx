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
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import { X, Search, Check, Users } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { GedcomIndividual } from '@/types/genealogy';
import { getSpouses } from '@/utils/gedcom-parser';
import { navigateBack, modalScreenOptions } from '@/utils/navigation';

function safeFamiliesAsSpouse(arr: string[] | undefined | null): string[] {
  return Array.isArray(arr) ? arr : [];
}

export default function LinkChildScreen() {
  const router = useRouter();
  const { parentId } = useLocalSearchParams<{ parentId: string }>();
  const {
    search,
    getPerson,
    treeData,
    isAdmin,
    submitEdit,
    linkChildToFamily,
    createFamilyWithParents,
    resolvePerson,
    isReady,
    isLoadingFromCloud,
  } = useFamilyTree();

  const [parent, setParent] = useState<GedcomIndividual | null>(null);
  const [child, setChild] = useState<GedcomIndividual | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<GedcomIndividual[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [selectedSpouseId, setSelectedSpouseId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isResolving, setIsResolving] = useState<boolean>(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!parentId || !isReady) return;
    const local = getPerson(parentId);
    if (local) {
      setParent(local);
      return;
    }
    let cancelled = false;
    setIsResolving(true);
    void resolvePerson(parentId).then((fetched) => {
      if (!cancelled && fetched) setParent(fetched);
    }).finally(() => {
      if (!cancelled) setIsResolving(false);
    });
    return () => { cancelled = true; };
  }, [parentId, isReady, getPerson, resolvePerson]);

  const spouses = useMemo(() => {
    if (!parentId || !treeData) return [];
    return getSpouses(parentId, treeData);
  }, [parentId, treeData]);

  const existingFamilies = useMemo(() => {
    if (!parent || !treeData) return [];
    return safeFamiliesAsSpouse(parent.familiesAsSpouse)
      .map((fid) => treeData.families.get(fid))
      .filter((f): f is NonNullable<typeof f> => f != null);
  }, [parent, treeData]);

  const handleSearch = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (text.trim().length >= 2) {
        searchTimerRef.current = setTimeout(() => {
          const found = search(text).filter((p) => p.id !== parentId);
          setSearchResults(found.slice(0, 30));
        }, 250);
      } else {
        setSearchResults([]);
      }
    },
    [search, parentId]
  );

  const handleSave = useCallback(async () => {
    if (!parent || !child || !parentId) return;

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (isAdmin) {
        let result: { success: boolean; error?: string };
        if (selectedFamilyId) {
          result = await linkChildToFamily(child.id, selectedFamilyId);
        } else {
          const created = await createFamilyWithParents(parentId, selectedSpouseId ?? undefined);
          if (!created.success || !created.familyId) {
            result = { success: false, error: created.error ?? 'Failed to create family' };
          } else {
            result = await linkChildToFamily(child.id, created.familyId);
          }
        }
        if (result.success) {
          Alert.alert('Success', 'Child linked successfully.', [{ text: 'OK', onPress: () => router.back() }]);
        } else {
          Alert.alert('Error', result.error ?? 'Failed to link child.');
        }
      } else {
        const result = await submitEdit('link_child', child.id, {
          childId: child.id,
          childName: child.name,
          parentId,
          familyId: selectedFamilyId ?? undefined,
          spouseId: selectedSpouseId ?? undefined,
        });
        if (result.success) {
          Alert.alert('Edit Submitted', 'Your link request has been submitted for admin review.', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        } else {
          Alert.alert('Error', result.error ?? 'Failed to submit for review.');
        }
      }
    } catch {
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setIsSaving(false);
    }
  }, [parent, child, parentId, selectedFamilyId, selectedSpouseId, isAdmin, linkChildToFamily, createFamilyWithParents, submitEdit, router]);

  if ((!isReady || isLoadingFromCloud || isResolving) && !parent) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Link Child' }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </View>
    );
  }

  if (!parent) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>Parent not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          ...modalScreenOptions,
          title: 'Link Child',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerLeft: () => (
            <TouchableOpacity onPress={() => navigateBack(router)} style={styles.headerBtn}>
              <X size={22} color={Colors.text} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={handleSave}
              disabled={!child || isSaving}
              style={[styles.saveBtn, (!child || isSaving) && { opacity: 0.5 }]}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.saveBtnText}>Link</Text>
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.parentBadge}>
          <Text style={styles.parentLabel}>Linking child to</Text>
          <Text style={styles.parentName}>{parent.name}</Text>
        </View>

        {child ? (
          <View style={styles.selectedCard}>
            <Text style={styles.selectedName}>{child.name}</Text>
            <TouchableOpacity onPress={() => setChild(null)}>
              <X size={16} color={Colors.textLight} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.searchBar}>
              <Search size={18} color={Colors.textLight} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search for existing person..."
                placeholderTextColor={Colors.textLight}
                value={searchQuery}
                onChangeText={handleSearch}
                autoCorrect={false}
              />
            </View>
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultItem}
                  onPress={() => {
                    setChild(item);
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
                  {searchQuery.length >= 2 ? 'No results found' : 'Search for a person to link as child'}
                </Text>
              }
            />
          </>
        )}

        {child && existingFamilies.length > 0 && (
          <View style={styles.familySection}>
            <View style={styles.sectionHeader}>
              <Users size={16} color={Colors.accent} />
              <Text style={styles.sectionTitle}>Select Family</Text>
            </View>
            {existingFamilies.map((fam) => (
              <TouchableOpacity
                key={fam.id}
                style={[styles.familyOption, selectedFamilyId === fam.id && styles.familyOptionSelected]}
                onPress={() => setSelectedFamilyId(fam.id)}
              >
                <Text style={styles.familyOptionText}>{fam.id}</Text>
                {selectedFamilyId === fam.id && <Check size={18} color={Colors.accent} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.familyOption, selectedFamilyId === null && styles.familyOptionSelected]}
              onPress={() => setSelectedFamilyId(null)}
            >
              <Text style={styles.familyOptionText}>Create new family</Text>
              {selectedFamilyId === null && <Check size={18} color={Colors.accent} />}
            </TouchableOpacity>
          </View>
        )}

        {child && !selectedFamilyId && spouses.length > 0 && (
          <View style={styles.familySection}>
            <Text style={styles.sectionTitle}>Co-parent (optional)</Text>
            {spouses.map((sp) => (
              <TouchableOpacity
                key={sp.id}
                style={[styles.familyOption, selectedSpouseId === sp.id && styles.familyOptionSelected]}
                onPress={() => setSelectedSpouseId(sp.id)}
              >
                <Text style={styles.familyOptionText}>{sp.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  saveBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    marginRight: 8,
  },
  saveBtnText: { color: Colors.white, fontWeight: '600' as const },
  headerBtn: { padding: 4, marginLeft: -4 },
  parentBadge: { padding: 16, alignItems: 'center' },
  parentLabel: { fontSize: 13, color: Colors.textSecondary },
  parentName: { fontSize: 16, fontWeight: '600' as const, color: Colors.text, marginTop: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
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
  selectedCard: {
    margin: 16,
    padding: 14,
    backgroundColor: Colors.card,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectedName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  familySection: { margin: 16, padding: 16, backgroundColor: Colors.card, borderRadius: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  familyOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginTop: 8,
  },
  familyOptionSelected: { borderColor: Colors.accent, backgroundColor: 'rgba(200, 149, 108, 0.08)' },
  familyOptionText: { fontSize: 14, color: Colors.text },
});
