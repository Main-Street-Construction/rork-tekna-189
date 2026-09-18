import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  Search,
  Database,
  Trash2,
  Save,
  GitMerge,
  Users,
  AlertTriangle,
  Link2,
  RefreshCw,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import {
  adminSearchIndividuals,
  adminUpdateIndividual,
  adminDeleteIndividual,
  type AdminIndividualRow,
} from '@/lib/supabase-rpc';
import { getCloudCounts, upsertFamilyInSupabase } from '@/lib/supabase-db';
import {
  displayName,
  findDuplicateFamilyGroups,
  personFamilyMap,
} from '@/utils/family-admin';
import type { GedcomFamily, GedcomIndividual } from '@/types/genealogy';

type TabKey = 'people' | 'families' | 'issues';

export default function AdminDataScreen() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const {
    treeData,
    individualCount,
    familyCount,
    refreshFromCloud,
    mergeIndividualsInTree,
    mergeFamiliesInTree,
    deleteFamilyFromTree,
    consolidateParallelFamilies,
    getPerson,
  } = useFamilyTree();

  const [tab, setTab] = useState<TabKey>('people');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminIndividualRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [cloudCounts, setCloudCounts] = useState<{ individuals: number; families: number } | null>(null);
  const [selected, setSelected] = useState<AdminIndividualRow | null>(null);
  const [inspectPersonId, setInspectPersonId] = useState<string | null>(null);
  const [mergeKeep, setMergeKeep] = useState<AdminIndividualRow | null>(null);
  const [mergeDuplicate, setMergeDuplicate] = useState<AdminIndividualRow | null>(null);
  const [familyMergeKeep, setFamilyMergeKeep] = useState<GedcomFamily | null>(null);
  const [familyMergeDup, setFamilyMergeDup] = useState<GedcomFamily | null>(null);
  const [merging, setMerging] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [familyQuery, setFamilyQuery] = useState('');
  const [resyncingFamilyId, setResyncingFamilyId] = useState<string | null>(null);

  const loadCloudCounts = useCallback(async () => {
    const counts = await getCloudCounts();
    if (counts) setCloudCounts(counts);
  }, []);

  React.useEffect(() => {
    if (isAdmin) void loadCloudCounts();
  }, [isAdmin, loadCloudCounts]);

  const duplicateGroups = useMemo(
    () => (treeData ? findDuplicateFamilyGroups(treeData) : []),
    [treeData]
  );

  const familyHits = useMemo(() => {
    if (!treeData) return [] as GedcomFamily[];
    const q = familyQuery.trim().toLowerCase();
    const all = Array.from(treeData.families.values());
    if (!q) return all.slice(0, 40);
    return all
      .filter((family) => {
        const husband = family.husbandId ? getPerson(family.husbandId) : null;
        const wife = family.wifeId ? getPerson(family.wifeId) : null;
        const hay = [
          family.id,
          husband?.name,
          husband?.givenName,
          husband?.surname,
          wife?.name,
          wife?.givenName,
          wife?.surname,
          ...family.childrenIds.map((id) => getPerson(id)?.name),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 60);
  }, [treeData, familyQuery, getPerson]);

  const inspectMap = useMemo(() => {
    if (!inspectPersonId || !treeData) return null;
    return personFamilyMap(inspectPersonId, treeData);
  }, [inspectPersonId, treeData]);

  const inspectPerson = inspectPersonId ? getPerson(inspectPersonId) : null;

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    const { rows, error } = await adminSearchIndividuals(query.trim());
    setSearching(false);
    if (error) {
      Alert.alert('Search Error', error);
      return;
    }
    setResults(rows);
  }, [query]);

  const openEdit = (row: AdminIndividualRow) => {
    setSelected(row);
    setEditFields({
      first_name: row.first_name ?? '',
      last_name: row.last_name ?? '',
      gender: row.gender ?? '',
      birth_date: row.birth_date ?? '',
      birth_place: row.birth_place ?? '',
      death_date: row.death_date ?? '',
      death_place: row.death_place ?? '',
      notes: row.notes ?? '',
    });
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    const result = await adminUpdateIndividual(selected.gedcom_id, {
      first_name: editFields.first_name || null,
      last_name: editFields.last_name || null,
      gender: editFields.gender || null,
      birth_date: editFields.birth_date || null,
      birth_place: editFields.birth_place || null,
      death_date: editFields.death_date || null,
      death_place: editFields.death_place || null,
      notes: editFields.notes || null,
    });
    setSaving(false);
    if (!result.success) {
      Alert.alert('Error', result.error ?? 'Save failed');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelected(null);
    void refreshFromCloud();
    void handleSearch();
  };

  const handleDelete = (row: AdminIndividualRow) => {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.gedcom_id;
    Alert.alert('Delete Person', `Permanently delete ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const result = await adminDeleteIndividual(row.gedcom_id);
          if (!result.success) {
            Alert.alert('Error', result.error ?? 'Delete failed');
            return;
          }
          setResults((prev) => prev.filter((r) => r.gedcom_id !== row.gedcom_id));
          void refreshFromCloud();
          void loadCloudCounts();
        },
      },
    ]);
  };

  const handleMerge = () => {
    if (!mergeKeep || !mergeDuplicate) {
      Alert.alert('Select Two People', 'Choose a primary record (keep) and a duplicate to merge.');
      return;
    }
    const keepName = [mergeKeep.first_name, mergeKeep.last_name].filter(Boolean).join(' ');
    const dupName = [mergeDuplicate.first_name, mergeDuplicate.last_name].filter(Boolean).join(' ');
    Alert.alert(
      'Merge Duplicates',
      `Keep "${keepName}" and merge "${dupName}" into it?\n\nParallel families with the same parents will also be collapsed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          style: 'destructive',
          onPress: async () => {
            setMerging(true);
            const result = await mergeIndividualsInTree(mergeKeep.gedcom_id, mergeDuplicate.gedcom_id);
            setMerging(false);
            if (!result.success) {
              Alert.alert('Merge Failed', result.error ?? 'Unknown error');
              return;
            }
            setMergeKeep(null);
            setMergeDuplicate(null);
            void refreshFromCloud();
            void handleSearch();
            Alert.alert('Merged', 'Duplicate person merged. Matching parent families were collapsed when found.');
          },
        },
      ]
    );
  };

  const handleFamilyMerge = () => {
    if (!familyMergeKeep || !familyMergeDup) {
      Alert.alert('Select Two Families', 'Choose which family to keep and which to merge away.');
      return;
    }
    Alert.alert(
      'Merge Families',
      `Keep ${familyMergeKeep.id} and fold ${familyMergeDup.id} into it? Children will be combined.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          style: 'destructive',
          onPress: async () => {
            setMerging(true);
            const result = await mergeFamiliesInTree(familyMergeKeep.id, familyMergeDup.id);
            setMerging(false);
            if (!result.success) {
              Alert.alert('Merge Failed', result.error ?? 'Unknown error');
              return;
            }
            setFamilyMergeKeep(null);
            setFamilyMergeDup(null);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  };

  const handleCollapseAllDuplicates = () => {
    Alert.alert(
      'Collapse Parallel Families',
      `Found ${duplicateGroups.length} parent pair${duplicateGroups.length === 1 ? '' : 's'} with more than one family. Merge each group into one family?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Collapse',
          style: 'destructive',
          onPress: async () => {
            setMerging(true);
            const result = await consolidateParallelFamilies();
            setMerging(false);
            if (!result.success) {
              Alert.alert('Failed', result.error ?? 'Could not collapse families');
              return;
            }
            Alert.alert('Done', `Merged ${result.merged} duplicate famil${result.merged === 1 ? 'y' : 'ies'}.`);
          },
        },
      ]
    );
  };

  const resyncFamily = async (family: GedcomFamily) => {
    setResyncingFamilyId(family.id);
    const result = await upsertFamilyInSupabase(family);
    setResyncingFamilyId(null);
    if (!result.success) {
      Alert.alert('Upload Failed', result.error ?? 'Could not sync family');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Synced', `Family ${family.id} was uploaded to Supabase.`);
  };

  const renderFamilyCard = (family: GedcomFamily, showMergePick = true) => {
    const husband = family.husbandId ? getPerson(family.husbandId) : null;
    const wife = family.wifeId ? getPerson(family.wifeId) : null;
    return (
      <View key={family.id} style={styles.familyCard}>
        <View style={styles.familyHeader}>
          <Text style={styles.familyId}>{family.id}</Text>
          <Text style={styles.familyMeta}>
            {family.childrenIds.length} child{family.childrenIds.length === 1 ? '' : 'ren'}
          </Text>
        </View>
        <Text style={styles.familyParents}>
          {displayName(husband, family.husbandId ?? '—')} · {displayName(wife, family.wifeId ?? '—')}
        </Text>
        {family.marriageDate || family.marriagePlace ? (
          <Text style={styles.familyMeta}>
            m. {[family.marriageDate, family.marriagePlace].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        <View style={styles.childChips}>
          {family.childrenIds.slice(0, 8).map((childId) => {
            const child = getPerson(childId);
            return (
              <TouchableOpacity
                key={childId}
                style={styles.childChip}
                onPress={() => {
                  setInspectPersonId(childId);
                  setTab('people');
                }}
              >
                <Text style={styles.childChipText}>{displayName(child, childId)}</Text>
              </TouchableOpacity>
            );
          })}
          {family.childrenIds.length > 8 ? (
            <Text style={styles.familyMeta}>+{family.childrenIds.length - 8} more</Text>
          ) : null}
        </View>
        <View style={styles.familyActions}>
          {showMergePick ? (
            <>
              <TouchableOpacity style={styles.smallBtn} onPress={() => setFamilyMergeKeep(family)}>
                <Text style={styles.smallBtnText}>Keep</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => setFamilyMergeDup(family)}>
                <Text style={styles.smallBtnText}>Dup</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <TouchableOpacity
            style={styles.smallBtn}
            onPress={() => void resyncFamily(family)}
            disabled={resyncingFamilyId === family.id}
          >
            {resyncingFamilyId === family.id ? (
              <ActivityIndicator size="small" color={Colors.accent} />
            ) : (
              <Text style={styles.smallBtnText}>Re-upload</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.smallBtnDanger}
            onPress={() => {
              Alert.alert('Delete Family', `Delete ${family.id}? Only empty families (no children) can be removed.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    const result = await deleteFamilyFromTree(family.id);
                    if (!result.success) Alert.alert('Error', result.error ?? 'Delete failed');
                  },
                },
              ]);
            }}
          >
            <Text style={styles.smallBtnDangerText}>Delete</Text>
          </TouchableOpacity>
          {(family.husbandId || family.wifeId) && (
            <TouchableOpacity
              style={styles.smallBtn}
              onPress={() => router.push(`/person/${family.husbandId || family.wifeId}`)}
            >
              <Text style={styles.smallBtnText}>Open</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Data Console' }} />
        <Text style={styles.denied}>Admin access required</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Data Console', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.text, headerShadowVisible: false }} />

      <View style={styles.syncBanner}>
        <Database size={16} color={Colors.accent} />
        <Text style={styles.syncText}>
          Local: {individualCount.toLocaleString()} people · {familyCount.toLocaleString()} families
        </Text>
        {cloudCounts && (
          <Text style={styles.syncTextSecondary}>
            Cloud: {cloudCounts.individuals.toLocaleString()} · {cloudCounts.families.toLocaleString()}
          </Text>
        )}
        {duplicateGroups.length > 0 ? (
          <Text style={styles.issueBannerText}>
            {duplicateGroups.length} parallel family group{duplicateGroups.length === 1 ? '' : 's'} detected
          </Text>
        ) : null}
        <TouchableOpacity onPress={() => void refreshFromCloud()} style={styles.syncRow}>
          <RefreshCw size={14} color={Colors.accent} />
          <Text style={styles.syncRefresh}>Sync from cloud</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        {([
          { key: 'people' as const, label: 'People', icon: Search },
          { key: 'families' as const, label: 'Families', icon: Users },
          { key: 'issues' as const, label: `Issues${duplicateGroups.length ? ` (${duplicateGroups.length})` : ''}`, icon: AlertTriangle },
        ]).map(({ key, label, icon: Icon }) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
          >
            <Icon size={14} color={tab === key ? Colors.white : Colors.textSecondary} />
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {tab === 'people' ? (
          <>
            <View style={styles.searchRow}>
              <Search size={18} color={Colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name or ID..."
                placeholderTextColor={Colors.textLight}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={() => void handleSearch()}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.searchBtn} onPress={() => void handleSearch()} disabled={searching}>
                {searching ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.searchBtnText}>Go</Text>}
              </TouchableOpacity>
            </View>

            <View style={styles.mergeSection}>
              <Text style={styles.mergeTitle}>Merge Duplicate People</Text>
              <Text style={styles.hint}>This also collapses families that end up with the same parents.</Text>
              <View style={styles.mergeRow}>
                <TouchableOpacity style={styles.mergeSlot} onPress={() => mergeKeep && setMergeKeep(null)}>
                  <Text style={styles.mergeSlotLabel}>Keep</Text>
                  <Text style={styles.mergeSlotValue}>
                    {mergeKeep ? [mergeKeep.first_name, mergeKeep.last_name].filter(Boolean).join(' ') : '—'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mergeSlot} onPress={() => mergeDuplicate && setMergeDuplicate(null)}>
                  <Text style={styles.mergeSlotLabel}>Merge away</Text>
                  <Text style={styles.mergeSlotValue}>
                    {mergeDuplicate ? [mergeDuplicate.first_name, mergeDuplicate.last_name].filter(Boolean).join(' ') : '—'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.mergeBtn, (!mergeKeep || !mergeDuplicate || merging) && { opacity: 0.5 }]}
                disabled={!mergeKeep || !mergeDuplicate || merging}
                onPress={handleMerge}
              >
                {merging ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.mergeBtnText}>Merge Records</Text>}
              </TouchableOpacity>
            </View>

            {inspectPerson && inspectMap ? (
              <View style={styles.inspectCard}>
                <View style={styles.inspectHeader}>
                  <Text style={styles.mergeTitle}>Family map · {displayName(inspectPerson)}</Text>
                  <TouchableOpacity onPress={() => setInspectPersonId(null)}>
                    <Text style={styles.syncRefresh}>Close</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.resultId}>{inspectPerson.id}</Text>
                <TouchableOpacity style={styles.openPersonBtn} onPress={() => router.push(`/person/${inspectPerson.id}`)}>
                  <Text style={styles.openPersonText}>Open person page</Text>
                </TouchableOpacity>

                <Text style={styles.sectionLabel}>As child</Text>
                {inspectMap.asChild ? (
                  renderFamilyCard(inspectMap.asChild, false)
                ) : (
                  <Text style={styles.hint}>No parent family linked.</Text>
                )}

                <Text style={styles.sectionLabel}>As spouse / parent</Text>
                {inspectMap.asSpouse.length === 0 ? (
                  <Text style={styles.hint}>No spouse families.</Text>
                ) : (
                  inspectMap.asSpouse.map(({ family, spouse, children }) => (
                    <View key={family.id} style={styles.mapBlock}>
                      <Text style={styles.mapLine}>
                        Spouse: {displayName(spouse, '—')} · Family {family.id}
                      </Text>
                      <Text style={styles.mapLine}>
                        Children: {children.length ? children.map((c) => displayName(c)).join(', ') : 'none'}
                      </Text>
                      {renderFamilyCard(family)}
                    </View>
                  ))
                )}
              </View>
            ) : null}

            {results.length === 0 && !searching ? (
              <Text style={styles.hint}>Search the database, then tap Map to inspect family links.</Text>
            ) : null}
            {results.map((row) => {
              const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.gedcom_id;
              return (
                <View key={row.gedcom_id} style={styles.resultCard}>
                  <TouchableOpacity style={styles.resultMain} onPress={() => openEdit(row)}>
                    <Text style={styles.resultName}>{name}</Text>
                    <Text style={styles.resultId}>{row.gedcom_id}</Text>
                    {row.birth_date ? <Text style={styles.resultMeta}>b. {row.birth_date}</Text> : null}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.mergePickBtn} onPress={() => setInspectPersonId(row.gedcom_id)}>
                    <Link2 size={14} color={Colors.accent} />
                    <Text style={styles.mergePickText}>Map</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.mergePickBtn} onPress={() => setMergeKeep(row)}>
                    <Text style={styles.mergePickText}>Keep</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.mergePickBtn} onPress={() => setMergeDuplicate(row)}>
                    <Text style={styles.mergePickText}>Dup</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteIcon} onPress={() => handleDelete(row)}>
                    <Trash2 size={18} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </>
        ) : null}

        {tab === 'families' ? (
          <>
            <View style={styles.searchRow}>
              <Search size={18} color={Colors.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Filter families by parent, child, or ID..."
                placeholderTextColor={Colors.textLight}
                value={familyQuery}
                onChangeText={setFamilyQuery}
              />
            </View>

            <View style={styles.mergeSection}>
              <Text style={styles.mergeTitle}>Merge Families</Text>
              <Text style={styles.hint}>Use this when the same couple appears twice with different family IDs.</Text>
              <View style={styles.mergeRow}>
                <TouchableOpacity style={styles.mergeSlot} onPress={() => familyMergeKeep && setFamilyMergeKeep(null)}>
                  <Text style={styles.mergeSlotLabel}>Keep family</Text>
                  <Text style={styles.mergeSlotValue}>{familyMergeKeep?.id ?? '—'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mergeSlot} onPress={() => familyMergeDup && setFamilyMergeDup(null)}>
                  <Text style={styles.mergeSlotLabel}>Merge away</Text>
                  <Text style={styles.mergeSlotValue}>{familyMergeDup?.id ?? '—'}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[styles.mergeBtn, (!familyMergeKeep || !familyMergeDup || merging) && { opacity: 0.5 }]}
                disabled={!familyMergeKeep || !familyMergeDup || merging}
                onPress={handleFamilyMerge}
              >
                {merging ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <>
                    <GitMerge size={16} color={Colors.white} />
                    <Text style={styles.mergeBtnText}>Merge Families</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {familyHits.map((family) => renderFamilyCard(family))}
            {familyHits.length === 0 ? <Text style={styles.hint}>No families matched.</Text> : null}
          </>
        ) : null}

        {tab === 'issues' ? (
          <>
            <View style={styles.mergeSection}>
              <Text style={styles.mergeTitle}>Parallel Families</Text>
              <Text style={styles.hint}>
                Same parents linked through more than one family ID — usually from a local add/merge. Collapse them to restore a single spouse link.
              </Text>
              <TouchableOpacity
                style={[styles.mergeBtn, (duplicateGroups.length === 0 || merging) && { opacity: 0.5 }]}
                disabled={duplicateGroups.length === 0 || merging}
                onPress={handleCollapseAllDuplicates}
              >
                {merging ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.mergeBtnText}>
                    Collapse all ({duplicateGroups.length} group{duplicateGroups.length === 1 ? '' : 's'})
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {duplicateGroups.length === 0 ? (
              <Text style={styles.hint}>No parallel families detected in the local tree.</Text>
            ) : (
              duplicateGroups.map((group) => {
                const sample = group[0];
                const husband = sample.husbandId ? getPerson(sample.husbandId) : null;
                const wife = sample.wifeId ? getPerson(sample.wifeId) : null;
                return (
                  <View key={parentPairKey(sample)} style={styles.issueGroup}>
                    <Text style={styles.mergeTitle}>
                      {displayName(husband, sample.husbandId ?? '—')} & {displayName(wife, sample.wifeId ?? '—')}
                    </Text>
                    <Text style={styles.familyMeta}>{group.length} families</Text>
                    {group.map((family) => renderFamilyCard(family))}
                  </View>
                );
              })
            )}
          </>
        ) : null}
      </ScrollView>

      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Text style={styles.modalTitle}>Edit {selected?.gedcom_id}</Text>
          {(['first_name', 'last_name', 'gender', 'birth_date', 'birth_place', 'death_date', 'death_place', 'notes'] as const).map((field) => (
            <View key={field} style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{field.replace(/_/g, ' ')}</Text>
              <TextInput
                style={[styles.fieldInput, field === 'notes' && styles.fieldInputMultiline]}
                value={editFields[field] ?? ''}
                onChangeText={(v) => setEditFields((f) => ({ ...f, [field]: v }))}
                multiline={field === 'notes'}
              />
            </View>
          ))}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setSelected(null)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSave} onPress={() => void handleSave()} disabled={saving}>
              {saving ? <ActivityIndicator color={Colors.white} /> : (
                <>
                  <Save size={16} color={Colors.white} />
                  <Text style={styles.modalSaveText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function parentPairKey(family: GedcomFamily): string {
  return `${family.husbandId ?? ''}|${family.wifeId ?? ''}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  denied: { textAlign: 'center', marginTop: 40, color: Colors.textSecondary },
  syncBanner: { margin: 16, marginBottom: 8, padding: 12, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, gap: 4 },
  syncText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  syncTextSecondary: { fontSize: 12, color: Colors.textSecondary },
  issueBannerText: { fontSize: 12, color: Colors.danger, fontWeight: '600' as const, marginTop: 2 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  syncRefresh: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  tab: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  tabActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  tabText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  tabTextActive: { color: Colors.white },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingHorizontal: 12, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, gap: 8 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 12 },
  searchBtn: { backgroundColor: Colors.accent, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  searchBtnText: { color: Colors.white, fontWeight: '600' as const },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  mergeSection: { marginBottom: 16, padding: 14, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  mergeTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text, marginBottom: 6 },
  mergeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  mergeSlot: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.background },
  mergeSlotLabel: { fontSize: 11, color: Colors.textSecondary },
  mergeSlotValue: { fontSize: 13, fontWeight: '600' as const, color: Colors.text, marginTop: 4 },
  mergeBtn: { marginTop: 12, backgroundColor: Colors.danger, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  mergeBtnText: { color: Colors.white, fontWeight: '600' as const },
  mergePickBtn: { paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center', gap: 2 },
  mergePickText: { fontSize: 11, color: Colors.accent, fontWeight: '600' as const },
  hint: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 8, lineHeight: 18 },
  resultCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 8, overflow: 'hidden' },
  resultMain: { flex: 1, padding: 14 },
  resultName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  resultId: { fontSize: 11, color: Colors.textLight, marginTop: 2 },
  resultMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  deleteIcon: { padding: 14 },
  inspectCard: { marginBottom: 16, padding: 14, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.accent },
  inspectHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { marginTop: 12, marginBottom: 6, fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const },
  openPersonBtn: { marginTop: 8, marginBottom: 4 },
  openPersonText: { color: Colors.accent, fontWeight: '600' as const, fontSize: 13 },
  mapBlock: { marginBottom: 8 },
  mapLine: { fontSize: 13, color: Colors.text, marginBottom: 4 },
  familyCard: { backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1, borderColor: Colors.cardBorder, padding: 12, marginBottom: 8 },
  familyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  familyId: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  familyParents: { fontSize: 14, color: Colors.text, marginTop: 4, fontWeight: '600' as const },
  familyMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  childChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  childChip: { backgroundColor: 'rgba(200, 149, 108, 0.12)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  childChipText: { fontSize: 12, color: Colors.accent, fontWeight: '500' as const },
  familyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.card },
  smallBtnText: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const },
  smallBtnDanger: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(196, 92, 74, 0.3)', backgroundColor: 'rgba(196, 92, 74, 0.08)' },
  smallBtnDangerText: { fontSize: 12, color: Colors.danger, fontWeight: '600' as const },
  issueGroup: { marginBottom: 16, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(196, 92, 74, 0.25)', backgroundColor: Colors.card },
  modal: { flex: 1, padding: 20, backgroundColor: Colors.background },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginBottom: 16 },
  fieldGroup: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 4, textTransform: 'capitalize' as const },
  fieldInput: { borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 8, padding: 10, fontSize: 15, color: Colors.text, backgroundColor: Colors.card },
  fieldInputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancel: { flex: 1, padding: 14, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: Colors.cardBorder },
  modalCancelText: { color: Colors.textSecondary, fontWeight: '600' as const },
  modalSave: { flex: 1, flexDirection: 'row', gap: 8, padding: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: Colors.success },
  modalSaveText: { color: Colors.white, fontWeight: '600' as const },
});
