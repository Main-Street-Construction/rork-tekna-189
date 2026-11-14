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
import { useColors, type ColorPalette } from '@/contexts/ThemeContext';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { PendingEdit, GedcomIndividual, GedcomFamily, FamilyTreeData } from '@/types/genealogy';
import {
  PENDING_EDIT_TYPE_LABELS,
  pendingEditSummary,
} from '@/utils/pending-edit-display';
import { findFamilyForParents } from '@/utils/family-admin';

const EDIT_TYPE_LABELS = PENDING_EDIT_TYPE_LABELS;

type FilterType = 'all' | 'edits' | 'adds' | 'links' | 'danger';

function getFilterCategory(editType: string): FilterType {
  if (editType === 'update_person' || editType === 'edit_marriage') return 'edits';
  if (editType === 'add_person' || editType === 'add_child' || editType === 'add_spouse') return 'adds';
  if (editType === 'link_spouses' || editType === 'link_child' || editType === 'edit_parent' || editType === 'remove_child' || editType === 'unlink_spouses') return 'links';
  if (editType === 'delete_person' || editType === 'merge_people') return 'danger';
  return 'all';
}

function familyLabelFromIds(
  familyId: string | undefined,
  treeData: FamilyTreeData | null,
  getPerson: (id: string) => GedcomIndividual | undefined
): string | undefined {
  if (!familyId || !treeData) return familyId;
  const fam = treeData.families.get(familyId);
  if (!fam) return familyId;
  const h = fam.husbandId ? getPerson(fam.husbandId)?.name : undefined;
  const w = fam.wifeId ? getPerson(fam.wifeId)?.name : undefined;
  const parts = [h, w].filter(Boolean);
  return parts.length ? `${parts.join(' & ')} (${familyId})` : familyId;
}

interface ValidationIssue {
  blocking: boolean;
  message: string;
}

/** Keep the submitter's allocated ID unless it already exists in the tree. */
async function resolveSubmittedPersonId(
  submittedId: string | undefined,
  treeData: FamilyTreeData | null,
  allocateGedcomId: (prefix: 'I' | 'F') => Promise<string>
): Promise<string> {
  if (submittedId && (!treeData || !treeData.individuals.has(submittedId))) {
    return submittedId;
  }
  return allocateGedcomId('I');
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

      if (edit.edit_type === 'delete_person') {
        const personId = (data.personId as string | undefined) ?? edit.target_id;
        if (personId && treeData && !treeData.individuals.has(personId)) {
          issues.push({ blocking: true, message: `Person ${personId} not found` });
        }
      }

      if (edit.edit_type === 'merge_people') {
        const keepId = data.keepId as string | undefined;
        const mergeId = data.mergeId as string | undefined;
        if (!keepId || !mergeId) {
          issues.push({ blocking: true, message: 'Missing keep or merge person id' });
        } else if (keepId === mergeId) {
          issues.push({ blocking: true, message: 'Cannot merge a person with themselves' });
        } else if (treeData) {
          if (!treeData.individuals.has(keepId)) {
            issues.push({ blocking: true, message: `Keep person ${keepId} not found` });
          }
          if (!treeData.individuals.has(mergeId)) {
            issues.push({ blocking: true, message: `Merge person ${mergeId} not found` });
          }
        }
      }

      return issues;
}

type SexType = 'M' | 'F' | 'U';

export default function PendingEditsScreen() {
  const Colors = useColors();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

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
    deleteIndividualFromTree,
    mergeIndividualsInTree,
    treeData,
    allocateGedcomId,
    refreshFromCloud,
    ensureEditDependencies,
    getTreeSnapshot,
    isLoadingFromCloud,
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
  /** Admin overrides for submitted child sex before approve */
  const [sexOverrides, setSexOverrides] = useState<Record<string, SexType>>({});

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

  const getChildSex = useCallback((edit: PendingEdit): SexType => {
    if (sexOverrides[edit.id]) return sexOverrides[edit.id];
    const child = (edit.data as Record<string, unknown>).child as GedcomIndividual | undefined;
    const sex = child?.sex;
    return sex === 'M' || sex === 'F' || sex === 'U' ? sex : 'U';
  }, [sexOverrides]);

  const applyEdit = useCallback(async (
    edit: PendingEdit,
    snapshot: FamilyTreeData | null
  ): Promise<{ success: boolean; error?: string }> => {
    const data = edit.data as Record<string, unknown>;
    const localTree = snapshot ?? getTreeSnapshot();
    try {
      if (edit.edit_type === 'update_person') {
        const individual = data.individual as GedcomIndividual;
        if (!individual) return { success: false, error: 'Missing individual data' };
        return await updatePerson(individual);
      }
      if (edit.edit_type === 'add_person') {
        const individual = data.individual as GedcomIndividual;
        if (!individual) return { success: false, error: 'Missing individual data' };
        const id = await resolveSubmittedPersonId(individual.id, localTree, allocateGedcomId);
        return await addPerson({ ...individual, id });
      }
      if (edit.edit_type === 'add_child') {
        const child = data.child as GedcomIndividual;
        const familyId = data.familyId as string | undefined;
        const parentId = data.parentId as string | undefined;
        const spouseId = data.spouseId as string | undefined;
        if (!child) return { success: false, error: 'Missing child data' };
        const id = await resolveSubmittedPersonId(child.id, localTree, allocateGedcomId);
        const sex = getChildSex(edit);
        const freshChild = {
          ...child,
          id,
          sex,
          familiesAsSpouse: child.familiesAsSpouse ?? [],
        };
        let resolvedFamilyId = familyId;
        if (!resolvedFamilyId && parentId && localTree) {
          resolvedFamilyId = findFamilyForParents(localTree, parentId, spouseId)?.id;
        }
        if (resolvedFamilyId) return await addChildToFamily(freshChild, resolvedFamilyId);
        if (parentId) return await createFamilyAndAddChild(freshChild, parentId, spouseId);
        return { success: false, error: 'Missing familyId or parentId' };
      }
      if (edit.edit_type === 'add_spouse') {
        const spouse = data.spouse as GedcomIndividual;
        const targetPersonId = data.personId as string | undefined;
        if (!spouse || !targetPersonId) return { success: false, error: 'Missing spouse or target' };
        const id = await resolveSubmittedPersonId(spouse.id, localTree, allocateGedcomId);
        const freshSpouse = { ...spouse, id, familiesAsSpouse: spouse.familiesAsSpouse ?? [] };
        return await addSpouse(targetPersonId, freshSpouse, data.marriageDate as string | undefined, data.marriagePlace as string | undefined);
      }
      if (edit.edit_type === 'link_spouses') {
        const person1Id = data.person1Id as string;
        const person2Id = data.person2Id as string;
        return await linkExistingSpouses(person1Id, person2Id, data.marriageDate as string | undefined, data.marriagePlace as string | undefined);
      }
      if (edit.edit_type === 'edit_marriage') {
        const familyId = data.familyId as string;
        if (!familyId || !localTree) return { success: false, error: 'Missing family' };
        const family = localTree.families.get(familyId);
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
        let resolvedFamilyId = familyId;
        if (!resolvedFamilyId && localTree) {
          resolvedFamilyId = findFamilyForParents(localTree, parentId, spouseId)?.id;
        }
        if (resolvedFamilyId) return await linkChildToFamily(childId, resolvedFamilyId);
        const child = localTree?.individuals.get(childId);
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
      if (edit.edit_type === 'delete_person') {
        const personId = (data.personId as string | undefined) ?? edit.target_id;
        if (!personId) return { success: false, error: 'Missing person id' };
        return await deleteIndividualFromTree(personId);
      }
      if (edit.edit_type === 'merge_people') {
        const keepId = data.keepId as string;
        const mergeId = data.mergeId as string;
        if (!keepId || !mergeId) return { success: false, error: 'Missing keep or merge id' };
        return await mergeIndividualsInTree(keepId, mergeId);
      }
      return { success: false, error: 'Unknown edit type' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }, [updatePerson, addPerson, addChildToFamily, createFamilyAndAddChild, createFamilyWithParents, addSpouse, linkExistingSpouses, linkChildToFamily, removeChildFromFamily, editParentFamily, unlinkSpouses, updateFamily, deleteIndividualFromTree, mergeIndividualsInTree, allocateGedcomId, getTreeSnapshot, getChildSex]);

  const handleApprove = useCallback(async (edit: PendingEdit) => {
    setProcessingId(edit.id);
    // Hydrate any missing parents/families from cloud before validation
    const hydrate = await ensureEditDependencies(edit);
    const snapshot = hydrate.tree ?? getTreeSnapshot();
    const issues = validateEdit(edit, snapshot);
    const blocking = issues.filter((i) => i.blocking);

    if (!hydrate.success || blocking.length > 0) {
      setProcessingId(null);
      Alert.alert(
        'Cannot Approve',
        [
          ...blocking.map((i) => i.message),
          hydrate.error && !blocking.length ? hydrate.error : null,
          'Try Sync from Cloud, then approve again.',
        ].filter(Boolean).join('\n')
      );
      return;
    }

    setProcessingId(null);
    const sex = getChildSex(edit);
    const sexNote =
      edit.edit_type === 'add_child'
        ? `\nSex: ${sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : 'Unknown'}`
        : '';
    const summary = pendingEditSummary(edit);
    const dangerNote =
      edit.edit_type === 'delete_person'
        ? '\n\nThis permanently deletes the person from the database.'
        : edit.edit_type === 'merge_people'
          ? '\n\nThe duplicate record will be merged away; matching parent families may collapse.'
          : '';

    Alert.alert(
      'Approve Edit',
      `Apply this ${EDIT_TYPE_LABELS[edit.edit_type] ?? edit.edit_type}?\n${summary}${sexNote}${dangerNote}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => {
            void (async () => {
              setProcessingId(edit.id);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              // Re-hydrate right before apply in case tree changed during the dialog
              const again = await ensureEditDependencies(edit);
              const latest = again.tree ?? getTreeSnapshot();
              const result = await applyEdit(edit, latest);
              if (result.success) {
                await reviewPendingEdit(edit.id, 'approved');
                setEdits((prev) => prev.filter((e) => e.id !== edit.id));
                setSexOverrides((prev) => {
                  const next = { ...prev };
                  delete next[edit.id];
                  return next;
                });
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } else {
                const errorMsg = result.error ?? 'Unknown error';
                Alert.alert('Apply Failed', errorMsg, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Sync & Retry',
                    onPress: () => {
                      void (async () => {
                        await refreshFromCloud({ force: true });
                        void handleApprove(edit);
                      })();
                    },
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
            })();
          },
        },
      ]
    );
  }, [ensureEditDependencies, getTreeSnapshot, applyEdit, reviewPendingEdit, refreshFromCloud, getChildSex]);

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

  const renderDiffRow = (label: string, oldVal: string | undefined | null, newVal: string | undefined | null) => {
    const oldText = oldVal?.toString().trim() || undefined;
    const newText = newVal?.toString().trim() || undefined;
    if (!oldText && !newText) return null;
    const changed = oldText !== newText;
    return (
      <View key={label} style={[styles.diffRow, changed && styles.diffRowChanged]}>
        <Text style={styles.diffLabel}>{label}</Text>
        {changed && oldText ? <Text style={styles.diffOld}>{oldText}</Text> : null}
        <Text style={styles.diffNew}>{newText ?? '(empty)'}</Text>
      </View>
    );
  };

  const renderEditDetails = useCallback((edit: PendingEdit) => {
    const data = edit.data as Record<string, unknown>;
    const rows: React.ReactNode[] = [];

    if (edit.edit_type === 'update_person') {
      const ind = data.individual as GedcomIndividual | undefined;
      const previous = data.previous as GedcomIndividual | undefined;
      const current = ind ? getPerson(ind.id) : undefined;
      const before = previous ?? current;
      if (ind) {
        rows.push(renderDiffRow('Name', before?.name, ind.name));
        rows.push(renderDiffRow('Birth Date', before?.birthDate, ind.birthDate));
        rows.push(renderDiffRow('Birth Place', before?.birthPlace, ind.birthPlace));
        rows.push(renderDiffRow('Death Date', before?.deathDate, ind.deathDate));
        rows.push(renderDiffRow('Death Place', before?.deathPlace, ind.deathPlace));
        rows.push(renderDiffRow('Occupation', before?.occupation, ind.occupation));
        rows.push(renderDiffRow('Note', before?.note, ind.note));
        rows.push(renderDiffRow('Sex', before?.sex, ind.sex));
        rows.push(renderDiffRow('ID', undefined, ind.id));
      }
    }

    if (edit.edit_type === 'edit_marriage') {
      const familyId = data.familyId as string;
      const family = treeData?.families.get(familyId);
      const p1 = (data.person1Name as string) || (family?.husbandId ? getPerson(family.husbandId)?.name : undefined);
      const p2 = (data.person2Name as string) || (family?.wifeId ? getPerson(family.wifeId)?.name : undefined);
      if (p1) rows.push(renderDiffRow('Spouse 1', undefined, p1));
      if (p2) rows.push(renderDiffRow('Spouse 2', undefined, p2));
      rows.push(renderDiffRow('Family', undefined, familyLabelFromIds(familyId, treeData, getPerson)));
      rows.push(renderDiffRow(
        'Marriage Date',
        (data.previousMarriageDate as string) || family?.marriageDate,
        data.marriageDate as string
      ));
      rows.push(renderDiffRow(
        'Marriage Place',
        (data.previousMarriagePlace as string) || family?.marriagePlace,
        data.marriagePlace as string
      ));
      if (data.childCount != null) {
        rows.push(renderDiffRow('Children in family', undefined, String(data.childCount)));
      }
    }

    if (['add_person', 'add_child', 'add_spouse'].includes(edit.edit_type)) {
      const ind = (data.individual ?? data.child ?? data.spouse) as GedcomIndividual | undefined;
      if (ind) {
        rows.push(renderDiffRow('Name', undefined, ind.name));
        rows.push(renderDiffRow('Given name', undefined, ind.givenName));
        rows.push(renderDiffRow('Surname', undefined, ind.surname));
        rows.push(renderDiffRow('Birth Date', undefined, ind.birthDate));
        rows.push(renderDiffRow('Birth Place', undefined, ind.birthPlace));
        rows.push(renderDiffRow('Death Date', undefined, ind.deathDate));
        rows.push(renderDiffRow('Death Place', undefined, ind.deathPlace));
        if (edit.edit_type !== 'add_child') {
          rows.push(renderDiffRow('Sex', undefined, ind.sex));
        }
        rows.push(renderDiffRow('Occupation', undefined, ind.occupation));
        rows.push(renderDiffRow('Note', undefined, ind.note));
        rows.push(renderDiffRow('ID', undefined, ind.id));
      }
      if (edit.edit_type === 'add_child') {
        const parentId = data.parentId as string | undefined;
        const spouseId = data.spouseId as string | undefined;
        const familyId = data.familyId as string | undefined;
        const parentName = (data.parentName as string) || (parentId ? getPerson(parentId)?.name : undefined);
        const spouseName = (data.spouseName as string) || (spouseId ? getPerson(spouseId)?.name : undefined);
        if (parentName) rows.push(renderDiffRow('Parent', undefined, parentName));
        if (parentId) rows.push(renderDiffRow('Parent ID', undefined, parentId));
        if (spouseName) rows.push(renderDiffRow('Other parent', undefined, spouseName));
        if (spouseId) rows.push(renderDiffRow('Other parent ID', undefined, spouseId));
        rows.push(renderDiffRow(
          'Family',
          undefined,
          (data.familyLabel as string) || familyLabelFromIds(familyId, treeData, getPerson) || (data.createNewFamily ? 'Create new family' : undefined)
        ));
        if (typeof data.createNewFamily === 'boolean') {
          rows.push(renderDiffRow('New family?', undefined, data.createNewFamily ? 'Yes' : 'No — existing'));
        }
      }
      if (edit.edit_type === 'add_spouse') {
        const personId = data.personId as string | undefined;
        rows.push(renderDiffRow(
          'Target Person',
          undefined,
          (data.personName as string) || (personId ? getPerson(personId)?.name : undefined) || personId
        ));
        if (personId) rows.push(renderDiffRow('Target ID', undefined, personId));
        rows.push(renderDiffRow('Marriage Date', undefined, data.marriageDate as string));
        rows.push(renderDiffRow('Marriage Place', undefined, data.marriagePlace as string));
      }
    }

    if (edit.edit_type === 'link_spouses') {
      const p1 = (data.person1Name as string) || (data.person1Id ? getPerson(data.person1Id as string)?.name : undefined);
      const p2 = (data.person2Name as string) || (data.person2Id ? getPerson(data.person2Id as string)?.name : undefined);
      rows.push(renderDiffRow('Person 1', undefined, p1 ?? (data.person1Id as string)));
      rows.push(renderDiffRow('Person 1 birth', undefined, data.person1BirthDate as string));
      rows.push(renderDiffRow('Person 1 sex', undefined, data.person1Sex as string));
      rows.push(renderDiffRow('Person 1 ID', undefined, data.person1Id as string));
      rows.push(renderDiffRow('Person 2', undefined, p2 ?? (data.person2Id as string)));
      rows.push(renderDiffRow('Person 2 birth', undefined, data.person2BirthDate as string));
      rows.push(renderDiffRow('Person 2 sex', undefined, data.person2Sex as string));
      rows.push(renderDiffRow('Person 2 ID', undefined, data.person2Id as string));
      rows.push(renderDiffRow('Marriage Date', undefined, data.marriageDate as string));
      rows.push(renderDiffRow('Marriage Place', undefined, data.marriagePlace as string));
    }

    if (edit.edit_type === 'link_child') {
      const childId = data.childId as string | undefined;
      const parentId = data.parentId as string | undefined;
      const spouseId = data.spouseId as string | undefined;
      const familyId = data.familyId as string | undefined;
      rows.push(renderDiffRow('Child', undefined, (data.childName as string) || (childId ? getPerson(childId)?.name : undefined) || childId));
      rows.push(renderDiffRow('Child ID', undefined, childId));
      rows.push(renderDiffRow('Birth Date', undefined, data.childBirthDate as string));
      rows.push(renderDiffRow('Birth Place', undefined, data.childBirthPlace as string));
      rows.push(renderDiffRow('Sex', undefined, data.childSex as string));
      rows.push(renderDiffRow('Parent', undefined, (data.parentName as string) || (parentId ? getPerson(parentId)?.name : undefined) || parentId));
      rows.push(renderDiffRow('Parent ID', undefined, parentId));
      rows.push(renderDiffRow('Other parent', undefined, (data.spouseName as string) || (spouseId ? getPerson(spouseId)?.name : undefined)));
      rows.push(renderDiffRow('Other parent ID', undefined, spouseId));
      rows.push(renderDiffRow('Family', undefined, familyLabelFromIds(familyId, treeData, getPerson)));
      if (typeof data.createNewFamily === 'boolean') {
        rows.push(renderDiffRow('New family?', undefined, data.createNewFamily ? 'Yes' : 'No — existing'));
      }
    }

    if (edit.edit_type === 'edit_parent' || edit.edit_type === 'remove_child') {
      const childId = data.childId as string | undefined;
      const familyId = data.familyId as string | undefined;
      rows.push(renderDiffRow('Child', undefined, (data.childName as string) || (childId ? getPerson(childId)?.name : undefined) || childId));
      rows.push(renderDiffRow('Child ID', undefined, childId));
      const parentNames = data.parentNames as string[] | undefined;
      if (parentNames?.length) {
        rows.push(renderDiffRow('Parents', undefined, parentNames.join(' & ')));
      } else {
        rows.push(renderDiffRow('Husband', undefined, data.husbandName as string));
        rows.push(renderDiffRow('Wife', undefined, data.wifeName as string));
      }
      rows.push(renderDiffRow('Family', undefined, familyLabelFromIds(familyId, treeData, getPerson)));
    }

    if (edit.edit_type === 'unlink_spouses') {
      const familyId = data.familyId as string | undefined;
      rows.push(renderDiffRow('Person 1', undefined, (data.person1Name as string) || (data.person1Id ? getPerson(data.person1Id as string)?.name : undefined)));
      rows.push(renderDiffRow('Person 1 ID', undefined, data.person1Id as string));
      rows.push(renderDiffRow('Person 2', undefined, (data.person2Name as string) || (data.person2Id ? getPerson(data.person2Id as string)?.name : undefined)));
      rows.push(renderDiffRow('Person 2 ID', undefined, data.person2Id as string));
      rows.push(renderDiffRow('Marriage Date', undefined, data.marriageDate as string));
      rows.push(renderDiffRow('Marriage Place', undefined, data.marriagePlace as string));
      rows.push(renderDiffRow('Children in family', undefined, data.childCount != null ? String(data.childCount) : undefined));
      rows.push(renderDiffRow('Family', undefined, familyLabelFromIds(familyId, treeData, getPerson)));
    }

    if (edit.edit_type === 'delete_person') {
      const person = (data.person as GedcomIndividual | undefined) || (edit.target_id ? getPerson(edit.target_id) : undefined);
      if (person) {
        rows.push(renderDiffRow('Name', undefined, person.name));
        rows.push(renderDiffRow('Given name', undefined, person.givenName));
        rows.push(renderDiffRow('Surname', undefined, person.surname));
        rows.push(renderDiffRow('Sex', undefined, person.sex));
        rows.push(renderDiffRow('Birth Date', undefined, person.birthDate));
        rows.push(renderDiffRow('Birth Place', undefined, person.birthPlace));
        rows.push(renderDiffRow('Death Date', undefined, person.deathDate));
        rows.push(renderDiffRow('Death Place', undefined, person.deathPlace));
        rows.push(renderDiffRow('Occupation', undefined, person.occupation));
        rows.push(renderDiffRow('Note', undefined, person.note));
        rows.push(renderDiffRow('ID', undefined, person.id));
      }
      const parents = data.parentNames as string[] | undefined;
      const spouses = data.spouseNames as string[] | undefined;
      const kids = data.childNames as string[] | undefined;
      if (parents?.length) rows.push(renderDiffRow('Parents', undefined, parents.join(', ')));
      if (spouses?.length) rows.push(renderDiffRow('Spouses', undefined, spouses.join(', ')));
      if (kids?.length) rows.push(renderDiffRow('Children', undefined, kids.join(', ')));
      if (data.reason) rows.push(renderDiffRow('Reason', undefined, data.reason as string));
    }

    if (edit.edit_type === 'merge_people') {
      const keep = (data.keepPerson as GedcomIndividual | undefined) || (data.keepId ? getPerson(data.keepId as string) : undefined);
      const merge = (data.mergePerson as GedcomIndividual | undefined) || (data.mergeId ? getPerson(data.mergeId as string) : undefined);
      rows.push(renderDiffRow('Keep', undefined, (data.keepName as string) || keep?.name || (data.keepId as string)));
      rows.push(renderDiffRow('Keep birth', undefined, keep?.birthDate));
      rows.push(renderDiffRow('Keep birth place', undefined, keep?.birthPlace));
      rows.push(renderDiffRow('Keep death', undefined, keep?.deathDate));
      rows.push(renderDiffRow('Keep death place', undefined, keep?.deathPlace));
      rows.push(renderDiffRow('Keep sex', undefined, keep?.sex));
      rows.push(renderDiffRow('Keep occupation', undefined, keep?.occupation));
      rows.push(renderDiffRow('Keep note', undefined, keep?.note));
      rows.push(renderDiffRow('Keep ID', undefined, keep?.id || (data.keepId as string)));
      rows.push(renderDiffRow('Merge away', undefined, (data.mergeName as string) || merge?.name || (data.mergeId as string)));
      rows.push(renderDiffRow('Merge birth', undefined, merge?.birthDate));
      rows.push(renderDiffRow('Merge birth place', undefined, merge?.birthPlace));
      rows.push(renderDiffRow('Merge death', undefined, merge?.deathDate));
      rows.push(renderDiffRow('Merge death place', undefined, merge?.deathPlace));
      rows.push(renderDiffRow('Merge sex', undefined, merge?.sex));
      rows.push(renderDiffRow('Merge occupation', undefined, merge?.occupation));
      rows.push(renderDiffRow('Merge note', undefined, merge?.note));
      rows.push(renderDiffRow('Merge ID', undefined, merge?.id || (data.mergeId as string)));
      rows.push(renderDiffRow('Reason', undefined, (data.reason as string) || (data.note as string)));
    }

    return rows.filter(Boolean);
  }, [getPerson, treeData]);

  const renderEditSummary = (edit: PendingEdit) => pendingEditSummary(edit);

  const submitterLabel = (edit: PendingEdit) => {
    const data = edit.data as Record<string, unknown>;
    const snappedName =
      typeof data.submitter_name === 'string' ? data.submitter_name.trim() : '';
    const snappedEmail =
      typeof data.submitter_email === 'string' ? data.submitter_email.trim() : '';
    const name = edit.submitter_name?.trim() || snappedName;
    const email = edit.submitter_email?.trim() || snappedEmail;
    if (name && email && name.toLowerCase() !== email.toLowerCase()) {
      return `${name} (${email})`;
    }
    if (name) return name;
    if (email) return email;
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
    { key: 'danger', label: 'Danger' },
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing || isLoadingFromCloud}
              onRefresh={async () => {
                setRefreshing(true);
                await refreshFromCloud({ force: true });
                await loadEdits();
                setRefreshing(false);
              }}
              tintColor={Colors.accent}
            />
          }
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
            <View style={styles.toolbarRight}>
              <TouchableOpacity
                style={styles.sortBtn}
                onPress={() => {
                  void (async () => {
                    setRefreshing(true);
                    await refreshFromCloud({ force: true });
                    await loadEdits();
                    setRefreshing(false);
                  })();
                }}
              >
                <Text style={styles.sortBtnText}>{isLoadingFromCloud ? 'Syncing…' : 'Sync from Cloud'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sortBtn} onPress={() => setOldestFirst((v) => !v)}>
                <Text style={styles.sortBtnText}>{oldestFirst ? 'Oldest first' : 'Newest first'}</Text>
              </TouchableOpacity>
            </View>
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
                const editData = edit.data as Record<string, unknown>;
                const personId =
                  edit.edit_type === 'update_person'
                    ? ((editData.individual as GedcomIndividual | undefined)?.id ?? edit.target_id)
                    : edit.edit_type === 'delete_person'
                      ? ((editData.personId as string | undefined) ?? edit.target_id)
                      : edit.edit_type === 'merge_people'
                        ? (editData.keepId as string | undefined)
                        : edit.edit_type === 'link_child' || edit.edit_type === 'remove_child'
                          ? (editData.childId as string | undefined)
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
                        <Text style={styles.warningText}>{issues.map((i) => i.message).join(' · ')} — Approve will sync missing records first</Text>
                        <TouchableOpacity onPress={() => void refreshFromCloud({ force: true })}>
                          <Text style={styles.refreshLink}>Sync</Text>
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
                        {edit.edit_type === 'add_child' ? (
                          <View style={styles.sexEditor}>
                            <Text style={styles.sexEditorLabel}>Sex (fix before approve if needed)</Text>
                            <View style={styles.sexRow}>
                              {([
                                { key: 'M' as SexType, label: 'Male' },
                                { key: 'F' as SexType, label: 'Female' },
                                { key: 'U' as SexType, label: 'Unknown' },
                              ]).map((option) => {
                                const selected = getChildSex(edit) === option.key;
                                return (
                                  <TouchableOpacity
                                    key={option.key}
                                    style={[styles.sexChip, selected && styles.sexChipActive]}
                                    onPress={() =>
                                      setSexOverrides((prev) => ({ ...prev, [edit.id]: option.key }))
                                    }
                                  >
                                    <Text style={[styles.sexChipText, selected && styles.sexChipTextActive]}>
                                      {option.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        ) : null}
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
                              style={[styles.actionBtn, styles.approveBtn]}
                              onPress={() => void handleApprove(edit)}
                              disabled={isProcessing}
                            >
                              {isProcessing ? <ActivityIndicator size="small" color={Colors.white} /> : (
                                <>
                                  <Check size={16} color={Colors.white} />
                                  <Text style={styles.approveBtnText}>
                                    {hasBlocking ? 'Sync & Approve' : 'Approve'}
                                  </Text>
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

function createStyles(Colors: ColorPalette) {
  return StyleSheet.create({
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
  toolbarRight: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },
  sortBtn: { alignSelf: 'flex-end' },
  sortBtnText: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const },
  sexEditor: { marginTop: 10, marginBottom: 4, gap: 8 },
  sexEditorLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const },
  sexRow: { flexDirection: 'row', gap: 8 },
  sexChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  sexChipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  sexChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  sexChipTextActive: { color: Colors.white },
  countRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginVertical: 12, gap: 8 },
  countText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  editCard: { backgroundColor: Colors.card, marginHorizontal: 16, marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  editHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  editHeaderInfo: { flex: 1 },
  editTypeLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const },
  editSummary: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, marginTop: 2 },
  submitterText: { fontSize: 11, color: Colors.textLight, marginTop: 4 },
  submitterBanner: {
    backgroundColor: Colors.accentMuted,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 2,
  },
  submitterBannerLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const },
  submitterBannerValue: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  submitterBannerMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Colors.dangerMuted },
  warningText: { flex: 1, fontSize: 11, color: Colors.danger },
  refreshLink: { fontSize: 11, fontWeight: '600' as const, color: Colors.accent },
  editDetails: { borderTopWidth: 1, borderTopColor: Colors.divider, padding: 14 },
  diffRow: { paddingVertical: 6 },
  diffRowChanged: { backgroundColor: Colors.successMuted, borderRadius: 6, paddingHorizontal: 8, marginVertical: 2 },
  diffLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' as const },
  diffOld: { fontSize: 12, color: Colors.danger, textDecorationLine: 'line-through' },
  diffNew: { fontSize: 13, color: Colors.text, fontWeight: '500' as const },
  personLink: { marginVertical: 8 },
  personLinkText: { fontSize: 13, color: Colors.accent, fontWeight: '600' as const },
  rejectForm: { gap: 8 },
  rejectInput: { borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 8, padding: 10, fontSize: 14, color: Colors.text, minHeight: 60, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 10, gap: 6 },
  rejectBtn: { backgroundColor: Colors.dangerMuted, borderWidth: 1, borderColor: Colors.danger },
  rejectBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.danger },
  approveBtn: { backgroundColor: Colors.success },
  approveBtnDisabled: { opacity: 0.5 },
  approveBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.white },
});
}
