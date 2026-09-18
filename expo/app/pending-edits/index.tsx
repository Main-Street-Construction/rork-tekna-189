import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  Check,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { PendingEdit, GedcomIndividual, GedcomFamily, FamilyTreeData } from '@/types/genealogy';

const EDIT_TYPE_LABELS: Record<string, string> = {
  update_person: 'Edit Person',
  add_person: 'Add Person',
  add_child: 'Add Child',
  add_spouse: 'Add Spouse',
  link_spouses: 'Link Spouses',
  edit_marriage: 'Edit Marriage',
  link_child: 'Link Child',
  edit_parent: 'Edit Parent',
  remove_child: 'Remove Child',
  unlink_spouses: 'Unlink Spouses',
};

type FilterType = 'all' | 'edits' | 'adds' | 'links';

function getFilterCategory(editType: string): FilterType {
  if (editType === 'update_person' || editType === 'edit_marriage') return 'edits';
  if (editType === 'add_person' || editType === 'add_child' || editType === 'add_spouse') return 'adds';
  if (editType === 'link_spouses' || editType === 'link_child' || editType === 'edit_parent' || editType === 'remove_child' || editType === 'unlink_spouses') return 'links';
  return 'all';
}

interface ValidationIssue {
  blocking: boolean;
  message: string;
}

function validateEdit(edit: PendingEdit, treeData: FamilyTreeData | null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const data = edit.data as Record<string, unknown>;

  if (edit.edit_type === 'update_person') {
    const ind = data.individual as GedcomIndividual | undefined;
    if (!ind) issues.push({ blocking: true, message: 'Missing person data' });
    else if (treeData && !treeData.individuals.has(ind.id)) {
      issues.push({ blocking: true, message: `Person ${ind.id} not in local tree — refresh data` });
    }
  }

  if (edit.edit_type === 'add_child') {
    const familyId = data.familyId as string | undefined;
    const parentId = data.parentId as string | undefined;
    if (familyId && treeData && !treeData.families.has(familyId)) {
      issues.push({ blocking: true, message: `Family ${familyId} not found` });
    }
    if (parentId && treeData && !treeData.individuals.has(parentId)) {
      issues.push({ blocking: true, message: `Parent ${parentId} not found` });
    }
  }

  if (edit.edit_type === 'add_spouse' || edit.edit_type === 'link_spouses') {
    const personId = (data.personId ?? data.person1Id) as string | undefined;
    const person2Id = data.person2Id as string | undefined;
    if (personId && treeData && !treeData.individuals.has(personId)) {
      issues.push({ blocking: true, message: `Person ${personId} not found` });
    }
    if (person2Id && treeData && !treeData.individuals.has(person2Id)) {
      issues.push({ blocking: true, message: `Person ${person2Id} not found` });
    }
  }

      if (edit.edit_type === 'edit_marriage') {
        const familyId = data.familyId as string;
        if (familyId && treeData && !treeData.families.has(familyId)) {
          issues.push({ blocking: true, message: `Family ${familyId} not found` });
        }
      }

      if (edit.edit_type === 'link_child') {
        const childId = data.childId as string | undefined;
        const familyId = data.familyId as string | undefined;
        const parentId = data.parentId as string | undefined;
        if (childId && treeData && !treeData.individuals.has(childId)) {
          issues.push({ blocking: true, message: `Child ${childId} not found` });
        }
        if (parentId && treeData && !treeData.individuals.has(parentId)) {
          issues.push({ blocking: true, message: `Parent ${parentId} not found` });
        }
        if (familyId && treeData && !treeData.families.has(familyId)) {
          issues.push({ blocking: true, message: `Family ${familyId} not found` });
        }
      }

      if (edit.edit_type === 'edit_parent' || edit.edit_type === 'remove_child') {
        const childId = data.childId as string | undefined;
        const familyId = data.familyId as string | undefined;
        if (childId && treeData && !treeData.individuals.has(childId)) {
          issues.push({ blocking: true, message: `Child ${childId} not found` });
        }
        if (familyId && treeData && !treeData.families.has(familyId)) {
          issues.push({ blocking: true, message: `Family ${familyId} not found` });
        }
      }

      if (edit.edit_type === 'unlink_spouses') {
        const familyId = data.familyId as string | undefined;
        if (familyId && treeData && !treeData.families.has(familyId)) {
          issues.push({ blocking: true, message: `Family ${familyId} not found` });
        }
      }

      return issues;
}

export default function PendingEditsScreen() {
  const router = useRouter();
  const {
    loadPendingEdits,
    reviewPendingEdit,
    getPerson,
    updatePerson,
    addPerson,
    addChildToFamily,
    createFamilyAndAddChild,
    createFamilyWithParents,
    addSpouse,
    linkExistingSpouses,
    linkChildToFamily,
    removeChildFromFamily,
    editParentFamily,
    unlinkSpouses,
    updateFamily,
    treeData,
    generateNewId,
    refreshFromCloud,
  } = useFamilyTree();

  const [edits, setEdits] = useState<PendingEdit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const loadEdits = useCallback(async () => {
    const result = await loadPendingEdits();
    setEdits(result);
  }, [loadPendingEdits]);

  useEffect(() => {
    setLoading(true);
    void loadEdits().finally(() => setLoading(false));
  }, [loadEdits]);

  const filteredEdits = useMemo(() => {
    let list = edits;
    if (filter !== 'all') {
      list = list.filter((e) => getFilterCategory(e.edit_type) === filter);
    }
    return [...list].sort((a, b) => {
      const aT = new Date(a.submitted_at).getTime();
      const bT = new Date(b.submitted_at).getTime();
      return oldestFirst ? aT - bT : bT - aT;
    });
  }, [edits, filter, oldestFirst]);

  const applyEdit = useCallback(async (edit: PendingEdit): Promise<{ success: boolean; error?: string }> => {
    const data = edit.data as Record<string, unknown>;
    try {
      if (edit.edit_type === 'update_person') {
        const individual = data.individual as GedcomIndividual;
        if (!individual) return { success: false, error: 'Missing individual data' };
        return await updatePerson(individual);
      }
      if (edit.edit_type === 'add_person') {
        const individual = data.individual as GedcomIndividual;
        if (!individual) return { success: false, error: 'Missing individual data' };
        const freshId = generateNewId('I');
        return await addPerson({ ...individual, id: freshId });
      }
      if (edit.edit_type === 'add_child') {
        const child = data.child as GedcomIndividual;
        const familyId = data.familyId as string | undefined;
        const parentId = data.parentId as string | undefined;
        const spouseId = data.spouseId as string | undefined;
        if (!child) return { success: false, error: 'Missing child data' };
        const freshChild = { ...child, id: generateNewId('I'), familiesAsSpouse: child.familiesAsSpouse ?? [] };
        if (familyId) return await addChildToFamily(freshChild, familyId);
        if (parentId) return await createFamilyAndAddChild(freshChild, parentId, spouseId);
        return { success: false, error: 'Missing familyId or parentId' };
      }
      if (edit.edit_type === 'add_spouse') {
        const spouse = data.spouse as GedcomIndividual;
        const targetPersonId = data.personId as string | undefined;
        if (!spouse || !targetPersonId) return { success: false, error: 'Missing spouse or target' };
        const freshSpouse = { ...spouse, id: generateNewId('I'), familiesAsSpouse: spouse.familiesAsSpouse ?? [] };
        return await addSpouse(targetPersonId, freshSpouse, data.marriageDate as string | undefined, data.marriagePlace as string | undefined);
      }
      if (edit.edit_type === 'link_spouses') {
        const person1Id = data.person1Id as string;
        const person2Id = data.person2Id as string;
        return await linkExistingSpouses(person1Id, person2Id, data.marriageDate as string | undefined, data.marriagePlace as string | undefined);
      }
      if (edit.edit_type === 'edit_marriage') {
        const familyId = data.familyId as string;
        if (!familyId || !treeData) return { success: false, error: 'Missing family' };
        const family = treeData.families.get(familyId);
        if (!family) return { success: false, error: `Family ${familyId} not found` };
        const updatedFamily: GedcomFamily = {
          ...family,
          marriageDate: (data.marriageDate as string) || undefined,
          marriagePlace: (data.marriagePlace as string) || undefined,
        };
        return await updateFamily(updatedFamily);
      }
      if (edit.edit_type === 'link_child') {
        const childId = data.childId as string;
        const familyId = data.familyId as string | undefined;
        const parentId = data.parentId as string | undefined;
        const spouseId = data.spouseId as string | undefined;
        if (!childId || !parentId) return { success: false, error: 'Missing child or parent' };
        if (familyId) return await linkChildToFamily(childId, familyId);
        const child = treeData?.individuals.get(childId);
        if (!child) return { success: false, error: 'Child not in local tree' };
        const created = await createFamilyWithParents(parentId, spouseId);
        if (!created.success || !created.familyId) {
          return { success: false, error: created.error ?? 'Failed to create family' };
        }
        return await linkChildToFamily(childId, created.familyId);
      }
      if (edit.edit_type === 'edit_parent') {
        const childId = data.childId as string;
        const familyId = data.familyId as string;
        if (!childId || !familyId) return { success: false, error: 'Missing child or family' };
        return await editParentFamily(childId, familyId);
      }
      if (edit.edit_type === 'remove_child') {
        const childId = data.childId as string;
        const familyId = data.familyId as string;
        if (!childId || !familyId) return { success: false, error: 'Missing child or family' };
        return await removeChildFromFamily(childId, familyId);
      }
      if (edit.edit_type === 'unlink_spouses') {
        const familyId = data.familyId as string;
        if (!familyId) return { success: false, error: 'Missing family' };
        return await unlinkSpouses(familyId);
      }
      return { success: false, error: 'Unknown edit type' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }, [updatePerson, addPerson, addChildToFamily, createFamilyAndAddChild, createFamilyWithParents, addSpouse, linkExistingSpouses, linkChildToFamily, removeChildFromFamily, editParentFamily, unlinkSpouses, updateFamily, treeData, generateNewId]);

  const handleApprove = useCallback(async (edit: PendingEdit, didRefresh = false) => {
    let issues = validateEdit(edit, treeData);
    let blocking = issues.filter((i) => i.blocking);
    if (blocking.length > 0 && !didRefresh && blocking.some((i) => i.message.includes('not found'))) {
      const refreshResult = await refreshFromCloud();
      if (refreshResult.success) {
        await handleApprove(edit, true);
        return;
      }
    }
    issues = validateEdit(edit, treeData);
    blocking = issues.filter((i) => i.blocking);
    if (blocking.length > 0) {
      Alert.alert('Cannot Approve', blocking.map((i) => i.message).join('\n'));
      return;
    }

    Alert.alert('Approve Edit', `Apply this ${EDIT_TYPE_LABELS[edit.edit_type] ?? edit.edit_type}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          setProcessingId(edit.id);
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          const result = await applyEdit(edit);
          if (result.success) {
            await reviewPendingEdit(edit.id, 'approved');
            setEdits((prev) => prev.filter((e) => e.id !== edit.id));
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } else {
            const errorMsg = result.error ?? 'Unknown error';
            Alert.alert('Apply Failed', errorMsg, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Retry',
                onPress: () => void handleApprove(edit),
              },
              {
                text: 'Reject',
                style: 'destructive',
                onPress: async () => {
                  await reviewPendingEdit(edit.id, 'rejected', errorMsg);
                  setEdits((prev) => prev.filter((e) => e.id !== edit.id));
                },
              },
            ]);
          }
          setProcessingId(null);
        },
      },
    ]);
  }, [applyEdit, reviewPendingEdit, treeData, refreshFromCloud]);

  const submitReject = useCallback(async (edit: PendingEdit, note?: string) => {
    setProcessingId(edit.id);
    await reviewPendingEdit(edit.id, 'rejected', note);
    setEdits((prev) => prev.filter((e) => e.id !== edit.id));
    setRejectingId(null);
    setRejectNote('');
    setProcessingId(null);
  }, [reviewPendingEdit]);

  const handleReject = useCallback((edit: PendingEdit) => {
    setRejectingId(edit.id);
    setRejectNote('');
  }, []);

  const renderDiffRow = (label: string, oldVal: string | undefined, newVal: string | undefined) => {
    if (oldVal === newVal && !newVal) return null;
    const changed = oldVal !== newVal;
    return (
      <View key={label} style={[styles.diffRow, changed && styles.diffRowChanged]}>
        <Text style={styles.diffLabel}>{label}</Text>
        {changed && oldVal ? <Text style={styles.diffOld}>{oldVal}</Text> : null}
        <Text style={styles.diffNew}>{newVal ?? '(empty)'}</Text>
      </View>
    );
  };

  const renderEditDetails = useCallback((edit: PendingEdit) => {
    const data = edit.data as Record<string, unknown>;
    const rows: React.ReactNode[] = [];

    if (edit.edit_type === 'update_person') {
      const ind = data.individual as GedcomIndividual | undefined;
      const current = ind ? getPerson(ind.id) : undefined;
      if (ind) {
        rows.push(renderDiffRow('Name', current?.name, ind.name));
        rows.push(renderDiffRow('Birth Date', current?.birthDate, ind.birthDate));
        rows.push(renderDiffRow('Birth Place', current?.birthPlace, ind.birthPlace));
        rows.push(renderDiffRow('Death Date', current?.deathDate, ind.deathDate));
        rows.push(renderDiffRow('Death Place', current?.deathPlace, ind.deathPlace));
        rows.push(renderDiffRow('Occupation', current?.occupation, ind.occupation));
        rows.push(renderDiffRow('Note', current?.note, ind.note));
        rows.push(renderDiffRow('Sex', current?.sex, ind.sex));
      }
    }

    if (edit.edit_type === 'edit_marriage') {
      const familyId = data.familyId as string;
      const family = treeData?.families.get(familyId);
      rows.push(renderDiffRow('Marriage Date', family?.marriageDate, data.marriageDate as string));
      rows.push(renderDiffRow('Marriage Place', family?.marriagePlace, data.marriagePlace as string));
    }

    if (['add_person', 'add_child', 'add_spouse'].includes(edit.edit_type)) {
      const ind = (data.individual ?? data.child ?? data.spouse) as GedcomIndividual | undefined;
      if (ind) {
        rows.push(renderDiffRow('Name', undefined, ind.name));
        rows.push(renderDiffRow('Birth Date', undefined, ind.birthDate));
        rows.push(renderDiffRow('Birth Place', undefined, ind.birthPlace));
        rows.push(renderDiffRow('Sex', undefined, ind.sex));
      }
      if (edit.edit_type === 'add_child') {
        const parentId = data.parentId as string | undefined;
        const spouseId = data.spouseId as string | undefined;
        const familyId = data.familyId as string | undefined;
        if (parentId) rows.push(renderDiffRow('Parent', undefined, getPerson(parentId)?.name ?? parentId));
        if (spouseId) rows.push(renderDiffRow('Spouse', undefined, getPerson(spouseId)?.name ?? spouseId));
        if (familyId) rows.push(renderDiffRow('Family ID', undefined, familyId));
      }
      if (edit.edit_type === 'add_spouse') {
        const personId = data.personId as string | undefined;
        if (personId) rows.push(renderDiffRow('Target Person', undefined, getPerson(personId)?.name ?? personId));
        rows.push(renderDiffRow('Marriage Date', undefined, data.marriageDate as string));
        rows.push(renderDiffRow('Marriage Place', undefined, data.marriagePlace as string));
      }
    }

    if (edit.edit_type === 'link_spouses') {
      rows.push(renderDiffRow('Person 1', undefined, data.person1Name as string));
      rows.push(renderDiffRow('Person 2', undefined, data.person2Name as string));
      rows.push(renderDiffRow('Marriage Date', undefined, data.marriageDate as string));
      rows.push(renderDiffRow('Marriage Place', undefined, data.marriagePlace as string));
    }

    return rows;
  }, [getPerson, treeData]);

  const renderEditSummary = (edit: PendingEdit) => {
    const data = edit.data as Record<string, unknown>;
    if (edit.edit_type === 'update_person') return (data.individual as GedcomIndividual)?.name ?? edit.target_id;
    if (edit.edit_type === 'add_person') return (data.individual as GedcomIndividual)?.name ?? 'New person';
    if (edit.edit_type === 'add_child') return (data.child as GedcomIndividual)?.name ?? 'New child';
    if (edit.edit_type === 'add_spouse') return (data.spouse as GedcomIndividual)?.name ?? 'New spouse';
    if (edit.edit_type === 'link_spouses') {
      const p1 = data.person1Name as string;
      const p2 = data.person2Name as string;
      return p1 && p2 ? `${p1} & ${p2}` : 'Link spouses';
    }
    if (edit.edit_type === 'edit_marriage') {
      const p1 = data.person1Name as string;
      const p2 = data.person2Name as string;
      return p1 && p2 ? `${p1} & ${p2}` : 'Edit marriage';
    }
    return edit.target_id;
  };

  const submitterLabel = (edit: PendingEdit) => {
    const name = edit.submitter_name?.trim();
    const email = edit.submitter_email?.trim();
    if (name && email && name.toLowerCase() !== email.toLowerCase()) {
      return `${name} (${email})`;
    }
    if (name) return name;
    if (email) return email;
    if (edit.submitted_by && edit.submitted_by !== 'anonymous') {
      return edit.submitted_by.length > 24 ? edit.submitted_by.slice(0, 24) + '…' : edit.submitted_by;
    }
    return 'Unknown submitter';
  };

  const formatTime = (time: string) => {
    const diffMins = Math.floor((Date.now() - new Date(time).getTime()) / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'edits', label: 'Edits' },
    { key: 'adds', label: 'Adds' },
    { key: 'links', label: 'Links' },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Pending Edits', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.text, headerShadowVisible: false }} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadEdits(); setRefreshing(false); }} tintColor={Colors.accent} />}
        >
          <View style={styles.toolbar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {filters.map((f) => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.sortBtn} onPress={() => setOldestFirst((v) => !v)}>
              <Text style={styles.sortBtnText}>{oldestFirst ? 'Oldest first' : 'Newest first'}</Text>
            </TouchableOpacity>
          </View>

          {filteredEdits.length === 0 ? (
            <View style={styles.centered}>
              <Check size={32} color={Colors.success} />
              <Text style={styles.emptyTitle}>All caught up!</Text>
            </View>
          ) : (
            <>
              <View style={styles.countRow}>
                <AlertTriangle size={14} color={Colors.accent} />
                <Text style={styles.countText}>{filteredEdits.length} edit{filteredEdits.length !== 1 ? 's' : ''} to review</Text>
              </View>
              {filteredEdits.map((edit) => {
                const isExpanded = expandedId === edit.id;
                const isProcessing = processingId === edit.id;
                const issues = validateEdit(edit, treeData);
                const hasBlocking = issues.some((i) => i.blocking);
                const personId = edit.edit_type === 'update_person'
                  ? (edit.data as Record<string, unknown>).individual
                    ? ((edit.data as Record<string, unknown>).individual as GedcomIndividual).id
                    : edit.target_id
                  : null;

                return (
                  <View key={edit.id} style={styles.editCard}>
                    <TouchableOpacity style={styles.editHeader} onPress={() => setExpandedId(isExpanded ? null : edit.id)} activeOpacity={0.7}>
                      <View style={styles.editHeaderInfo}>
                        <Text style={styles.editTypeLabel}>{EDIT_TYPE_LABELS[edit.edit_type] ?? edit.edit_type}</Text>
                        <Text style={styles.editSummary} numberOfLines={1}>{renderEditSummary(edit)}</Text>
                        <Text style={styles.submitterText}>Submitted by {submitterLabel(edit)} · {formatTime(edit.submitted_at)}</Text>
                      </View>
                      {isExpanded ? <ChevronUp size={16} color={Colors.textLight} /> : <ChevronDown size={16} color={Colors.textLight} />}
                    </TouchableOpacity>

                    {hasBlocking && (
                      <View style={styles.warningBanner}>
                        <AlertTriangle size={14} color={Colors.danger} />
                        <Text style={styles.warningText}>{issues.map((i) => i.message).join(' · ')}</Text>
                        <TouchableOpacity onPress={() => void refreshFromCloud()}>
                          <Text style={styles.refreshLink}>Refresh</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {isExpanded && (
                      <View style={styles.editDetails}>
                        <View style={styles.submitterBanner}>
                          <Text style={styles.submitterBannerLabel}>Submitted by</Text>
                          <Text style={styles.submitterBannerValue}>{submitterLabel(edit)}</Text>
                          <Text style={styles.submitterBannerMeta}>{new Date(edit.submitted_at).toLocaleString()}</Text>
                        </View>
                        {renderEditDetails(edit)}
                        {personId ? (
                          <TouchableOpacity style={styles.personLink} onPress={() => router.push(`/person/${personId}`)}>
                            <Text style={styles.personLinkText}>View person in tree</Text>
                          </TouchableOpacity>
                        ) : null}

                        {rejectingId === edit.id ? (
                          <View style={styles.rejectForm}>
                            <TextInput
                              style={styles.rejectInput}
                              placeholder="Optional note for submitter..."
                              placeholderTextColor={Colors.textLight}
                              value={rejectNote}
                              onChangeText={setRejectNote}
                              multiline
                            />
                            <View style={styles.editActions}>
                              <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => setRejectingId(null)}>
                                <Text style={styles.rejectBtnText}>Cancel</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={[styles.actionBtn, styles.approveBtn]} onPress={() => void submitReject(edit, rejectNote.trim() || undefined)}>
                                <Text style={styles.approveBtnText}>Confirm Reject</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : (
                          <View style={styles.editActions}>
                            <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleReject(edit)} disabled={isProcessing}>
                              <X size={16} color={Colors.danger} />
                              <Text style={styles.rejectBtnText}>Reject</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.actionBtn, styles.approveBtn, hasBlocking && styles.approveBtnDisabled]}
                              onPress={() => void handleApprove(edit)}
                              disabled={isProcessing || hasBlocking}
                            >
                              {isProcessing ? <ActivityIndicator size="small" color={Colors.white} /> : (
                                <>
                                  <Check size={16} color={Colors.white} />
                                  <Text style={styles.approveBtnText}>Approve</Text>
                                </>
                              )}
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600' as const, color: Colors.text },
  toolbar: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  filterRow: { gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder },
  filterChipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  filterChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.white },
  sortBtn: { alignSelf: 'flex-end' },
  sortBtnText: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const },
  countRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginVertical: 12, gap: 8 },
  countText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  editCard: { backgroundColor: Colors.card, marginHorizontal: 16, marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  editHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  editHeaderInfo: { flex: 1 },
  editTypeLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const },
  editSummary: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, marginTop: 2 },
  submitterText: { fontSize: 11, color: Colors.textLight, marginTop: 4 },
  submitterBanner: {
    backgroundColor: 'rgba(200, 149, 108, 0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 2,
  },
  submitterBannerLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const },
  submitterBannerValue: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  submitterBannerMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(196, 92, 74, 0.08)' },
  warningText: { flex: 1, fontSize: 11, color: Colors.danger },
  refreshLink: { fontSize: 11, fontWeight: '600' as const, color: Colors.accent },
  editDetails: { borderTopWidth: 1, borderTopColor: Colors.divider, padding: 14 },
  diffRow: { paddingVertical: 6 },
  diffRowChanged: { backgroundColor: 'rgba(74, 124, 89, 0.06)', borderRadius: 6, paddingHorizontal: 8, marginVertical: 2 },
  diffLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' as const },
  diffOld: { fontSize: 12, color: Colors.danger, textDecorationLine: 'line-through' },
  diffNew: { fontSize: 13, color: Colors.text, fontWeight: '500' as const },
  personLink: { marginVertical: 8 },
  personLinkText: { fontSize: 13, color: Colors.accent, fontWeight: '600' as const },
  rejectForm: { gap: 8 },
  rejectInput: { borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 8, padding: 10, fontSize: 14, color: Colors.text, minHeight: 60, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 10, gap: 6 },
  rejectBtn: { backgroundColor: 'rgba(196, 92, 74, 0.1)', borderWidth: 1, borderColor: 'rgba(196, 92, 74, 0.2)' },
  rejectBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.danger },
  approveBtn: { backgroundColor: Colors.success },
  approveBtnDisabled: { opacity: 0.5 },
  approveBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.white },
});
