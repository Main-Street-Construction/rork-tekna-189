import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  Check,
  X,
  UserPlus,
  Pencil,
  Users,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertTriangle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { PendingEdit, GedcomIndividual, GedcomFamily } from '@/types/genealogy';

const EDIT_TYPE_LABELS: Record<string, string> = {
  update_person: 'Edit Person',
  add_person: 'Add Person',
  add_child: 'Add Child',
  add_spouse: 'Add Spouse',
  link_spouses: 'Link Spouses',
  edit_marriage: 'Edit Marriage',
};

const EDIT_TYPE_ICONS: Record<string, React.ReactNode> = {
  update_person: <Pencil size={16} color={Colors.accent} />,
  add_person: <UserPlus size={16} color={Colors.success} />,
  add_child: <Users size={16} color={Colors.male} />,
  add_spouse: <Users size={16} color={Colors.female} />,
  link_spouses: <Users size={16} color={Colors.accent} />,
  edit_marriage: <Pencil size={16} color={Colors.female} />,
};

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
    addSpouse,
    linkExistingSpouses,
    updateFamily,
    treeData,
  } = useFamilyTree();

  const [edits, setEdits] = useState<PendingEdit[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEdits = useCallback(async () => {
    console.log('[PendingEdits] Loading...');
    const result = await loadPendingEdits();
    setEdits(result);
    console.log('[PendingEdits] Loaded', result.length, 'edits');
  }, [loadPendingEdits]);

  useEffect(() => {
    setLoading(true);
    loadEdits().finally(() => setLoading(false));
  }, [loadEdits]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEdits();
    setRefreshing(false);
  }, [loadEdits]);

  const applyEdit = useCallback(async (edit: PendingEdit): Promise<boolean> => {
    const data = edit.data as Record<string, unknown>;
    try {
      if (edit.edit_type === 'update_person') {
        const individual = data.individual as GedcomIndividual;
        if (!individual) return false;
        const result = await updatePerson(individual);
        return result.success;
      }

      if (edit.edit_type === 'add_person') {
        const individual = data.individual as GedcomIndividual;
        if (!individual) return false;
        const result = await addPerson(individual);
        return result.success;
      }

      if (edit.edit_type === 'add_child') {
        const child = data.child as GedcomIndividual;
        const familyId = data.familyId as string | undefined;
        const parentId = data.parentId as string | undefined;
        const spouseId = data.spouseId as string | undefined;

        if (!child) return false;

        if (familyId) {
          const result = await addChildToFamily(child, familyId);
          return result.success;
        } else if (parentId) {
          const result = await createFamilyAndAddChild(child, parentId, spouseId);
          return result.success;
        }
        return false;
      }

      if (edit.edit_type === 'add_spouse') {
        const spouse = data.spouse as GedcomIndividual;
        const targetPersonId = data.personId as string | undefined;
        const mDate = data.marriageDate as string | undefined;
        const mPlace = data.marriagePlace as string | undefined;

        if (!spouse || !targetPersonId) return false;

        const result = await addSpouse(targetPersonId, spouse, mDate, mPlace);
        return result.success;
      }

      if (edit.edit_type === 'link_spouses') {
        const person1Id = data.person1Id as string | undefined;
        const person2Id = data.person2Id as string | undefined;
        const mDate = data.marriageDate as string | undefined;
        const mPlace = data.marriagePlace as string | undefined;

        if (!person1Id || !person2Id) return false;

        const result = await linkExistingSpouses(person1Id, person2Id, mDate, mPlace);
        return result.success;
      }

      if (edit.edit_type === 'edit_marriage') {
        const familyId = data.familyId as string | undefined;
        const marriageDate = data.marriageDate as string | undefined;
        const marriagePlace = data.marriagePlace as string | undefined;

        if (!familyId || !treeData) return false;

        const family = treeData.families.get(familyId);
        if (!family) return false;

        const updatedFamily: GedcomFamily = {
          ...family,
          marriageDate: marriageDate || undefined,
          marriagePlace: marriagePlace || undefined,
        };
        const result = await updateFamily(updatedFamily);
        return result.success;
      }

      return false;
    } catch (e) {
      console.error('[PendingEdits] Error applying edit:', e);
      return false;
    }
  }, [updatePerson, addPerson, addChildToFamily, createFamilyAndAddChild, addSpouse, linkExistingSpouses, updateFamily, treeData]);

  const handleApprove = useCallback(async (edit: PendingEdit) => {
    Alert.alert(
      'Approve Edit',
      `Apply this ${EDIT_TYPE_LABELS[edit.edit_type] ?? edit.edit_type}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setProcessingId(edit.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

            const applied = await applyEdit(edit);
            if (applied) {
              await reviewPendingEdit(edit.id, 'approved');
              setEdits((prev) => prev.filter((e) => e.id !== edit.id));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else {
              Alert.alert('Error', 'Failed to apply this edit. It may reference data that no longer exists.');
              await reviewPendingEdit(edit.id, 'rejected', 'Failed to apply');
              setEdits((prev) => prev.filter((e) => e.id !== edit.id));
            }
            setProcessingId(null);
          },
        },
      ]
    );
  }, [applyEdit, reviewPendingEdit]);

  const handleReject = useCallback(async (edit: PendingEdit) => {
    Alert.alert(
      'Reject Edit',
      `Reject this ${EDIT_TYPE_LABELS[edit.edit_type] ?? edit.edit_type}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setProcessingId(edit.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await reviewPendingEdit(edit.id, 'rejected');
            setEdits((prev) => prev.filter((e) => e.id !== edit.id));
            setProcessingId(null);
          },
        },
      ]
    );
  }, [reviewPendingEdit]);

  const renderEditSummary = useCallback((edit: PendingEdit) => {
    const data = edit.data as Record<string, unknown>;

    if (edit.edit_type === 'update_person') {
      const ind = data.individual as GedcomIndividual | undefined;
      return ind ? `${ind.name}` : edit.target_id;
    }

    if (edit.edit_type === 'add_person') {
      const ind = data.individual as GedcomIndividual | undefined;
      return ind ? `${ind.name}` : 'New person';
    }

    if (edit.edit_type === 'add_child') {
      const child = data.child as GedcomIndividual | undefined;
      return child ? `${child.name}` : 'New child';
    }

    if (edit.edit_type === 'add_spouse') {
      const spouse = data.spouse as GedcomIndividual | undefined;
      return spouse ? `${spouse.name}` : 'New spouse';
    }

    if (edit.edit_type === 'link_spouses') {
      const p1Name = data.person1Name as string | undefined;
      const p2Name = data.person2Name as string | undefined;
      return p1Name && p2Name ? `${p1Name} & ${p2Name}` : 'Link spouses';
    }

    if (edit.edit_type === 'edit_marriage') {
      const p1Name = data.person1Name as string | undefined;
      const p2Name = data.person2Name as string | undefined;
      return p1Name && p2Name ? `${p1Name} & ${p2Name}` : 'Edit marriage';
    }

    return edit.target_id;
  }, []);

  const renderEditDetails = useCallback((edit: PendingEdit) => {
    const data = edit.data as Record<string, unknown>;
    const details: { label: string; value: string }[] = [];

    if (edit.edit_type === 'update_person') {
      const ind = data.individual as GedcomIndividual | undefined;
      if (ind) {
        details.push({ label: 'Name', value: ind.name });
        if (ind.birthDate) details.push({ label: 'Birth Date', value: ind.birthDate });
        if (ind.birthPlace) details.push({ label: 'Birth Place', value: ind.birthPlace });
        if (ind.deathDate) details.push({ label: 'Death Date', value: ind.deathDate });
        if (ind.occupation) details.push({ label: 'Occupation', value: ind.occupation });
        details.push({ label: 'Sex', value: ind.sex === 'M' ? 'Male' : ind.sex === 'F' ? 'Female' : 'Unknown' });
      }
    }

    if (edit.edit_type === 'link_spouses') {
      const p1Name = data.person1Name as string | undefined;
      const p2Name = data.person2Name as string | undefined;
      const mDate = data.marriageDate as string | undefined;
      const mPlace = data.marriagePlace as string | undefined;
      if (p1Name) details.push({ label: 'Person 1', value: p1Name });
      if (p2Name) details.push({ label: 'Person 2', value: p2Name });
      if (mDate) details.push({ label: 'Marriage Date', value: mDate });
      if (mPlace) details.push({ label: 'Marriage Place', value: mPlace });
    }

    if (edit.edit_type === 'edit_marriage') {
      const p1Name = data.person1Name as string | undefined;
      const p2Name = data.person2Name as string | undefined;
      const mDate = data.marriageDate as string | undefined;
      const mPlace = data.marriagePlace as string | undefined;
      if (p1Name) details.push({ label: 'Person 1', value: p1Name });
      if (p2Name) details.push({ label: 'Person 2', value: p2Name });
      if (mDate) details.push({ label: 'Marriage Date', value: mDate });
      if (mPlace) details.push({ label: 'Marriage Place', value: mPlace });
    }

    if (edit.edit_type === 'add_person' || edit.edit_type === 'add_child' || edit.edit_type === 'add_spouse') {
      const ind = (data.individual ?? data.child ?? data.spouse) as GedcomIndividual | undefined;
      if (ind) {
        details.push({ label: 'Name', value: ind.name });
        if (ind.birthDate) details.push({ label: 'Birth Date', value: ind.birthDate });
        if (ind.birthPlace) details.push({ label: 'Birth Place', value: ind.birthPlace });
        details.push({ label: 'Sex', value: ind.sex === 'M' ? 'Male' : ind.sex === 'F' ? 'Female' : 'Unknown' });
      }
      if (edit.edit_type === 'add_child') {
        const parentId = data.parentId as string | undefined;
        if (parentId) {
          const parent = getPerson(parentId);
          if (parent) details.push({ label: 'Parent', value: parent.name });
        }
      }
    }

    return details;
  }, [getPerson]);

  const formatTime = (time: string) => {
    const d = new Date(time);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Pending Edits',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false,
        }}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading pending edits...</Text>
        </View>
      ) : edits.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />
          }
        >
          <View style={styles.emptyIcon}>
            <Check size={32} color={Colors.success} />
          </View>
          <Text style={styles.emptyTitle}>All caught up!</Text>
          <Text style={styles.emptyDesc}>No pending edits to review. Pull down to refresh.</Text>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />
          }
        >
          <View style={styles.countRow}>
            <AlertTriangle size={14} color={Colors.accent} />
            <Text style={styles.countText}>
              {edits.length} edit{edits.length !== 1 ? 's' : ''} awaiting your review
            </Text>
          </View>

          {edits.map((edit) => {
            const isExpanded = expandedId === edit.id;
            const isProcessing = processingId === edit.id;
            const details = renderEditDetails(edit);

            return (
              <View key={edit.id} style={styles.editCard}>
                <TouchableOpacity
                  style={styles.editHeader}
                  onPress={() => setExpandedId(isExpanded ? null : edit.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.editTypeIcon}>
                    {EDIT_TYPE_ICONS[edit.edit_type] ?? <Pencil size={16} color={Colors.accent} />}
                  </View>
                  <View style={styles.editHeaderInfo}>
                    <Text style={styles.editTypeLabel}>
                      {EDIT_TYPE_LABELS[edit.edit_type] ?? edit.edit_type}
                    </Text>
                    <Text style={styles.editSummary} numberOfLines={1}>
                      {renderEditSummary(edit)}
                    </Text>
                  </View>
                  <View style={styles.editTimeCol}>
                    <View style={styles.editTimeRow}>
                      <Clock size={10} color={Colors.textLight} />
                      <Text style={styles.editTime}>{formatTime(edit.submitted_at)}</Text>
                    </View>
                    {isExpanded ? (
                      <ChevronUp size={16} color={Colors.textLight} />
                    ) : (
                      <ChevronDown size={16} color={Colors.textLight} />
                    )}
                  </View>
                </TouchableOpacity>

                {isExpanded && (
                  <View style={styles.editDetails}>
                    {details.map((d, i) => (
                      <View key={i} style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{d.label}</Text>
                        <Text style={styles.detailValue}>{d.value}</Text>
                      </View>
                    ))}

                    <Text style={styles.submittedBy}>
                      Submitted by: {edit.submitted_by.length > 20 ? edit.submitted_by.slice(0, 20) + '...' : edit.submitted_by}
                    </Text>

                    <View style={styles.editActions}>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.rejectBtn]}
                        onPress={() => handleReject(edit)}
                        disabled={isProcessing}
                        activeOpacity={0.7}
                      >
                        {isProcessing ? (
                          <ActivityIndicator size="small" color={Colors.danger} />
                        ) : (
                          <>
                            <X size={16} color={Colors.danger} />
                            <Text style={styles.rejectBtnText}>Reject</Text>
                          </>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.actionBtn, styles.approveBtn]}
                        onPress={() => handleApprove(edit)}
                        disabled={isProcessing}
                        activeOpacity={0.7}
                      >
                        {isProcessing ? (
                          <ActivityIndicator size="small" color={Colors.white} />
                        ) : (
                          <>
                            <Check size={16} color={Colors.white} />
                            <Text style={styles.approveBtnText}>Approve</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(74, 124, 89, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    gap: 8,
  },
  countText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  editCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  editTypeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editHeaderInfo: {
    flex: 1,
  },
  editTypeLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  editSummary: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 2,
  },
  editTimeCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  editTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  editTime: {
    fontSize: 11,
    color: Colors.textLight,
  },
  editDetails: {
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  detailLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  detailValue: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '600' as const,
    maxWidth: '60%',
    textAlign: 'right',
  },
  submittedBy: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 8,
    marginBottom: 12,
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    gap: 6,
  },
  rejectBtn: {
    backgroundColor: 'rgba(196, 92, 74, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(196, 92, 74, 0.2)',
  },
  rejectBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.danger,
  },
  approveBtn: {
    backgroundColor: Colors.success,
  },
  approveBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.white,
  },
});
