import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack, type Href } from 'expo-router';
import {
  MapPin,
  Calendar,
  Briefcase,
  Users,
  ArrowLeft,
  GitBranch,

  Heart,
  FileText,
  Pencil,
  UserPlus,
  HeartHandshake,
  Link,
  Home,
  MoreHorizontal,
  Link2Off,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { useProfile } from '@/contexts/ProfileContext';
import {
  getParents,
  getSpouses,
  getChildren,
  getSiblings,
} from '@/utils/gedcom-parser';
import { calculateRelationship } from '@/utils/relationship';
import PersonCard from '@/components/PersonCard';
import SectionHeader from '@/components/SectionHeader';
import FamilyTreePreview from '@/components/FamilyTreePreview';
import { GedcomIndividual, GedcomFamily } from '@/types/genealogy';
import { navigateBack } from '@/utils/navigation';

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { treeData, getPerson, isAdmin, submitEdit, removeChildFromFamily, unlinkSpouses } = useFamilyTree();
  const { profile } = useProfile();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [spouseMenuVisible, setSpouseMenuVisible] = useState<boolean>(false);
  const [childMenuVisible, setChildMenuVisible] = useState<boolean>(false);
  const [relationMenu, setRelationMenu] = useState<
    | { kind: 'marriage'; family: GedcomFamily; spouseName: string }
    | { kind: 'child'; child: GedcomIndividual; familyId: string }
    | null
  >(null);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  const person = useMemo(() => {
    if (!id) return undefined;
    return getPerson(id);
  }, [id, getPerson]);

  const parents = useMemo(() => {
    if (!id || !treeData) return [];
    return getParents(id, treeData);
  }, [id, treeData]);

  const spouses = useMemo(() => {
    if (!id || !treeData) return [];
    return getSpouses(id, treeData);
  }, [id, treeData]);

  const children = useMemo(() => {
    if (!id || !treeData) return [];
    return getChildren(id, treeData);
  }, [id, treeData]);

  const siblings = useMemo(() => {
    if (!id || !treeData) return [];
    return getSiblings(id, treeData);
  }, [id, treeData]);

  const relationToRoot = useMemo(() => {
    if (!id || !treeData || !profile?.rootPersonId) return null;
    if (id === profile.rootPersonId) return { relationship: 'This is you', reverseRelationship: 'Self' };
    const result = calculateRelationship(profile.rootPersonId, id, treeData);
    if (!result) return null;
    return {
      relationship: result.relationship,
      reverseRelationship: result.reverseRelationship,
    };
  }, [id, treeData, profile?.rootPersonId]);

  const grandparents = useMemo(() => {
    if (!treeData) return [];
    const gps: GedcomIndividual[] = [];
    for (const parent of parents) {
      const pParents = getParents(parent.id, treeData);
      for (const gp of pParents) {
        if (!gps.some((g) => g.id === gp.id)) {
          gps.push(gp);
        }
      }
    }
    return gps;
  }, [parents, treeData]);

  const greatGrandparents = useMemo(() => {
    if (!treeData) return [];
    const ggps: GedcomIndividual[] = [];
    for (const gp of grandparents) {
      const gpParents = getParents(gp.id, treeData);
      for (const ggp of gpParents) {
        if (!ggps.some((g) => g.id === ggp.id)) {
          ggps.push(ggp);
        }
      }
    }
    return ggps;
  }, [grandparents, treeData]);

  const grandchildren = useMemo(() => {
    if (!treeData) return [];
    const gcs: GedcomIndividual[] = [];
    for (const child of children) {
      const cChildren = getChildren(child.id, treeData);
      for (const gc of cChildren) {
        if (!gcs.some((g) => g.id === gc.id)) {
          gcs.push(gc);
        }
      }
    }
    return gcs;
  }, [children, treeData]);

  const handleGoBack = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigateBack(router);
  }, [router]);

  const handleGoHome = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Prefer navigate over replace so search tab state/history survives.
    if (typeof router.dismissAll === 'function') {
      try {
        router.dismissAll();
      } catch {
        // fall through
      }
    }
    router.navigate('/(tabs)/(search)');
  }, [router]);

  const handlePersonPress = useCallback(
    (p: { id: string }) => {
      if (p.id === id) return;
      router.push(`/person/${p.id}` as const);
    },
    [router, id]
  );

  const handleEdit = useCallback(() => {
    if (!id) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/edit-person/${id}`);
  }, [id, router]);

  const handleAddChild = useCallback(() => {
    if (!id) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/add-child/${id}`);
  }, [id, router]);

  const handleAddSpouse = useCallback(() => {
    if (!id) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/add-spouse/${id}`);
  }, [id, router]);

  const handleEditMarriage = useCallback((familyId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/edit-marriage/${familyId}`);
  }, [router]);

  const handleLinkSpouses = useCallback(() => {
    if (!id) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/link-spouses?prefill=${id}`);
  }, [router, id]);

  const handleLinkChild = useCallback(() => {
    if (!id) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/link-child/${id}`);
  }, [router, id]);

  const handleUnlinkSpouse = useCallback((familyId: string) => {
    Alert.alert('Unlink Spouses', 'Remove this marriage link? Both people will be kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink',
        style: 'destructive',
        onPress: async () => {
          if (isAdmin) {
            const result = await unlinkSpouses(familyId);
            if (!result.success) Alert.alert('Error', result.error ?? 'Failed to unlink.');
          } else {
            const result = await submitEdit('unlink_spouses', familyId, { familyId });
            if (result.success) {
              Alert.alert('Submitted', 'Unlink request sent for admin review.');
            } else {
              Alert.alert('Error', result.error ?? 'Failed to submit.');
            }
          }
        },
      },
    ]);
  }, [isAdmin, unlinkSpouses, submitEdit]);

  const handleRemoveChild = useCallback((childId: string, familyId: string) => {
    Alert.alert('Remove Child Link', 'Remove this parent-child relationship?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (isAdmin) {
            const result = await removeChildFromFamily(childId, familyId);
            if (!result.success) Alert.alert('Error', result.error ?? 'Failed to remove.');
          } else {
            const result = await submitEdit('remove_child', childId, { childId, familyId });
            if (result.success) {
              Alert.alert('Submitted', 'Removal request sent for admin review.');
            } else {
              Alert.alert('Error', result.error ?? 'Failed to submit.');
            }
          }
        },
      },
    ]);
  }, [isAdmin, removeChildFromFamily, submitEdit]);

  const spouseFamilies = useMemo(() => {
    if (!id || !treeData) return [];
    const families: GedcomFamily[] = [];
    for (const famId of (person?.familiesAsSpouse ?? [])) {
      const fam = treeData.families.get(famId);
      if (fam) families.push(fam);
    }
    return families;
  }, [id, treeData, person]);

  if (!person) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Person not found</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigateBack(router)}
          >
            <ArrowLeft size={18} color={Colors.white} />
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const genderColor =
    person.sex === 'F'
      ? Colors.female
      : person.sex === 'M'
        ? Colors.male
        : Colors.textSecondary;
  const initials = (person.givenName?.[0] ?? '') + (person.surname?.[0] ?? '');

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: person.name,
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.accent,
          headerShadowVisible: false,
          // Use the native stack back control — custom headerLeft was unreliable on modals/cards.
          headerBackVisible: true,
          headerBackButtonDisplayMode: 'minimal',
          headerLeft: undefined,
          headerRight: () => (
            <TouchableOpacity onPress={handleGoHome} style={styles.editHeaderBtn} hitSlop={16}>
              <Home size={18} color={Colors.accent} />
            </TouchableOpacity>
          ),
        }}
      />
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroSection}>
            <View style={[styles.heroAvatar, { backgroundColor: genderColor }]}>
              <Text style={styles.heroAvatarText}>{initials}</Text>
            </View>
            <Text style={styles.heroName}>{person.name}</Text>
            {person.sex !== 'U' && (
              <Text style={styles.heroGender}>
                {person.sex === 'M' ? 'Male' : 'Female'}
              </Text>
            )}

            {relationToRoot && (
              <View style={styles.relationBadge}>
                <GitBranch size={14} color={Colors.accent} />
                <Text style={styles.relationText}>
                  {relationToRoot.relationship}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.detailsGrid}>
            {person.birthDate && (
              <View style={styles.detailCard}>
                <Calendar size={16} color={Colors.accent} />
                <View>
                  <Text style={styles.detailLabel}>Born</Text>
                  <Text style={styles.detailValue}>{person.birthDate}</Text>
                </View>
              </View>
            )}
            {person.birthPlace && (
              <View style={styles.detailCard}>
                <MapPin size={16} color={Colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailLabel}>Birthplace</Text>
                  <Text style={styles.detailValue} numberOfLines={2}>
                    {person.birthPlace}
                  </Text>
                </View>
              </View>
            )}
            {person.deathDate && (
              <View style={styles.detailCard}>
                <Calendar size={16} color={Colors.textSecondary} />
                <View>
                  <Text style={styles.detailLabel}>Died</Text>
                  <Text style={styles.detailValue}>{person.deathDate}</Text>
                </View>
              </View>
            )}
            {person.deathPlace && (
              <View style={styles.detailCard}>
                <MapPin size={16} color={Colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailLabel}>Death Place</Text>
                  <Text style={styles.detailValue} numberOfLines={2}>
                    {person.deathPlace}
                  </Text>
                </View>
              </View>
            )}
            {person.occupation && (
              <View style={styles.detailCard}>
                <Briefcase size={16} color={Colors.accent} />
                <View>
                  <Text style={styles.detailLabel}>Occupation</Text>
                  <Text style={styles.detailValue}>{person.occupation}</Text>
                </View>
              </View>
            )}
          </View>

          <FamilyTreePreview
            person={person}
            parents={parents}
            spouses={spouses}
            children={children}
            siblings={siblings}
            grandparents={grandparents}
            greatGrandparents={greatGrandparents}
            grandchildren={grandchildren}
            onPersonPress={handlePersonPress}
            onExploreTree={() => {
              if (!id) return;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push(`/tree/${id}` as Href);
            }}
          />

          {parents.length > 0 && (
            <View style={styles.relationSection}>
              <SectionHeader title="Parents" count={parents.length} />
              <View style={styles.relationList}>
                {parents.map((p) => (
                  <PersonCard
                    key={p.id}
                    person={p}
                    onPress={handlePersonPress}
                    subtitle={p.sex === 'F' ? 'Mother' : 'Father'}
                    compact
                  />
                ))}
              </View>
            </View>
          )}

          {spouses.length > 0 && (
            <View style={styles.relationSection}>
              <SectionHeader title="Spouses" count={spouses.length} />
              <View style={styles.relationList}>
                {spouses.map((s) => {
                  const matchingFamily = spouseFamilies.find(
                    (f) => f.husbandId === s.id || f.wifeId === s.id
                  );
                  return (
                    <View key={s.id}>
                      <PersonCard
                        person={s}
                        onPress={handlePersonPress}
                        subtitle={s.sex === 'F' ? 'Wife' : 'Husband'}
                        compact
                      />
                      {matchingFamily && (
                        <View style={styles.marriageRow}>
                          <TouchableOpacity
                            style={styles.marriageInfoRow}
                            onPress={() => handleEditMarriage(matchingFamily.id)}
                            activeOpacity={0.7}
                          >
                            <Heart size={12} color={Colors.accent} />
                            <Text style={styles.marriageInfoText} numberOfLines={1}>
                              {matchingFamily.marriageDate || matchingFamily.marriagePlace
                                ? [matchingFamily.marriageDate, matchingFamily.marriagePlace].filter(Boolean).join(' — ')
                                : 'No marriage details'}
                            </Text>
                            <Pencil size={12} color={Colors.textLight} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.marriageMoreBtn}
                            onPress={() => {
                              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setRelationMenu({
                                kind: 'marriage',
                                family: matchingFamily,
                                spouseName: s.name,
                              });
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityLabel="Marriage options"
                          >
                            <MoreHorizontal size={16} color={Colors.textLight} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {children.length > 0 && (
            <View style={styles.relationSection}>
              <SectionHeader title="Children" count={children.length} />
              <View style={styles.relationList}>
                {children.map((c) => {
                  const childFamily = spouseFamilies.find((f) =>
                    (Array.isArray(f.childrenIds) ? f.childrenIds : []).includes(c.id)
                  )
                    ?? (c.familyAsChild && treeData?.families.get(c.familyAsChild) ? treeData.families.get(c.familyAsChild) : undefined);
                  const childFamilyId = childFamily?.id;
                  return (
                    <PersonCard
                      key={c.id}
                      person={c}
                      onPress={handlePersonPress}
                      onLongPress={
                        childFamilyId
                          ? () => setRelationMenu({ kind: 'child', child: c, familyId: childFamilyId })
                          : undefined
                      }
                      subtitle={c.sex === 'F' ? 'Daughter' : 'Son'}
                      compact
                    />
                  );
                })}
              </View>
            </View>
          )}

          {siblings.length > 0 && (
            <View style={styles.relationSection}>
              <SectionHeader title="Siblings" count={siblings.length} />
              <View style={styles.relationList}>
                {siblings.map((s) => (
                  <PersonCard
                    key={s.id}
                    person={s}
                    onPress={handlePersonPress}
                    subtitle={s.sex === 'F' ? 'Sister' : 'Brother'}
                    compact
                  />
                ))}
              </View>
            </View>
          )}

          {parents.length === 0 &&
            spouses.length === 0 &&
            children.length === 0 &&
            siblings.length === 0 && (
              <View style={styles.noRelations}>
                <Users size={24} color={Colors.textLight} />
                <Text style={styles.noRelationsText}>
                  No family connections found for this person.
                </Text>
              </View>
            )}

          {person.note?.trim() ? (
            <View style={styles.notesSection}>
              <SectionHeader title="Notes" />
              <View style={styles.notesCard}>
                <FileText size={16} color={Colors.accent} style={{ marginTop: 2 }} />
                <Text style={styles.notesText}>{person.note}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleEdit} activeOpacity={0.7}>
              <Pencil size={18} color={Colors.white} />
              <Text style={styles.actionBtnText}>{isAdmin ? 'Edit' : 'Suggest edit'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addChildBtn} onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setChildMenuVisible(true); }} activeOpacity={0.7}>
              <UserPlus size={18} color={Colors.accent} />
              <Text style={styles.addChildBtnText}>Child</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addChildBtn} onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSpouseMenuVisible(true); }} activeOpacity={0.7}>
              <HeartHandshake size={18} color={Colors.accent} />
              <Text style={styles.addChildBtnText}>Spouse</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.actionHint}>
            {isAdmin
              ? 'Edit names, add children, or link another spouse (including a previous marriage).'
              : 'Suggest name fixes, add a child, or link a spouse — including a previous marriage. Changes go to admins for approval; track them under Profile → My Edits.'}
          </Text>

          <Modal
            visible={spouseMenuVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setSpouseMenuVisible(false)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setSpouseMenuVisible(false)}>
              <View style={styles.menuSheet}>
                <Text style={styles.menuTitle}>Add Spouse</Text>
                <TouchableOpacity
                  style={styles.menuOption}
                  onPress={() => { setSpouseMenuVisible(false); handleAddSpouse(); }}
                  activeOpacity={0.7}
                >
                  <UserPlus size={20} color={Colors.accent} />
                  <View style={styles.menuOptionTextWrap}>
                    <Text style={styles.menuOptionTitle}>Create New Person</Text>
                    <Text style={styles.menuOptionDesc}>Add a current or previous spouse</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.menuOption}
                  onPress={() => { setSpouseMenuVisible(false); handleLinkSpouses(); }}
                  activeOpacity={0.7}
                >
                  <Link size={20} color={Colors.accent} />
                  <View style={styles.menuOptionTextWrap}>
                    <Text style={styles.menuOptionTitle}>Link Existing People</Text>
                    <Text style={styles.menuOptionDesc}>Connect two people already in the tree</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.menuCancel}
                  onPress={() => setSpouseMenuVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.menuCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Modal>

          <Modal
            visible={childMenuVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setChildMenuVisible(false)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setChildMenuVisible(false)}>
              <View style={styles.menuSheet}>
                <Text style={styles.menuTitle}>Add Child</Text>
                <TouchableOpacity
                  style={styles.menuOption}
                  onPress={() => { setChildMenuVisible(false); handleAddChild(); }}
                  activeOpacity={0.7}
                >
                  <UserPlus size={20} color={Colors.accent} />
                  <View style={styles.menuOptionTextWrap}>
                    <Text style={styles.menuOptionTitle}>Create New Person</Text>
                    <Text style={styles.menuOptionDesc}>Add a child — pick which spouse/family on the next screen</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.menuOption}
                  onPress={() => { setChildMenuVisible(false); handleLinkChild(); }}
                  activeOpacity={0.7}
                >
                  <Link size={20} color={Colors.accent} />
                  <View style={styles.menuOptionTextWrap}>
                    <Text style={styles.menuOptionTitle}>Link Existing Person</Text>
                    <Text style={styles.menuOptionDesc}>Connect someone already in the tree as a child</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.menuCancel}
                  onPress={() => setChildMenuVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.menuCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Modal>

          <Modal
            visible={relationMenu !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setRelationMenu(null)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setRelationMenu(null)}>
              <Pressable style={styles.menuSheet} onPress={(e) => e.stopPropagation()}>
                {relationMenu?.kind === 'marriage' && (
                  <>
                    <Text style={styles.menuTitle}>Marriage with {relationMenu.spouseName}</Text>
                    <TouchableOpacity
                      style={styles.menuOption}
                      onPress={() => {
                        setRelationMenu(null);
                        handleEditMarriage(relationMenu.family.id);
                      }}
                      activeOpacity={0.7}
                    >
                      <Pencil size={20} color={Colors.accent} />
                      <View style={styles.menuOptionTextWrap}>
                        <Text style={styles.menuOptionTitle}>Edit marriage details</Text>
                        <Text style={styles.menuOptionDesc}>Date, place, and other info</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.menuOptionDestructive}
                      onPress={() => {
                        const familyId = relationMenu.family.id;
                        setRelationMenu(null);
                        handleUnlinkSpouse(familyId);
                      }}
                      activeOpacity={0.7}
                    >
                      <Link2Off size={20} color={Colors.danger} />
                      <View style={styles.menuOptionTextWrap}>
                        <Text style={styles.menuOptionTitleDestructive}>Remove marriage link</Text>
                        <Text style={styles.menuOptionDesc}>Both people are kept in the tree</Text>
                      </View>
                    </TouchableOpacity>
                  </>
                )}
                {relationMenu?.kind === 'child' && (
                  <>
                    <Text style={styles.menuTitle}>{relationMenu.child.name}</Text>
                    <TouchableOpacity
                      style={styles.menuOptionDestructive}
                      onPress={() => {
                        const { child, familyId } = relationMenu;
                        setRelationMenu(null);
                        handleRemoveChild(child.id, familyId);
                      }}
                      activeOpacity={0.7}
                    >
                      <Link2Off size={20} color={Colors.danger} />
                      <View style={styles.menuOptionTextWrap}>
                        <Text style={styles.menuOptionTitleDestructive}>Remove family link</Text>
                        <Text style={styles.menuOptionDesc}>This person stays in the tree</Text>
                      </View>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity
                  style={styles.menuCancel}
                  onPress={() => setRelationMenu(null)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.menuCancelText}>Cancel</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </Modal>
        </ScrollView>
      </Animated.View>
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  backButtonText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  heroSection: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  heroAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroAvatarText: {
    color: Colors.white,
    fontSize: 26,
    fontWeight: '700' as const,
    letterSpacing: 1,
  },
  heroName: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center',
  },
  heroGender: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  relationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: Colors.overlay,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  relationText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
  detailsGrid: {
    paddingHorizontal: 16,
    gap: 8,
  },
  detailCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  detailLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  detailValue: {
    fontSize: 15,
    color: Colors.text,
    fontWeight: '500' as const,
    marginTop: 1,
  },
  relationSection: {
    marginTop: 8,
  },
  relationList: {
    paddingHorizontal: 16,
  },
  noRelations: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 32,
    gap: 12,
  },
  noRelationsText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  notesSection: {
    marginTop: 16,
  },
  notesCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 12,
  },
  notesText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    lineHeight: 21,
  },
  headerRightRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
  },
  editHeaderBtn: {
    padding: 6,
  },
  actionButtons: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 24,
    gap: 12,
  },
  actionHint: {
    marginHorizontal: 20,
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.textSecondary,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  actionBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600' as const,
  },
  addChildBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  addChildBtnText: {
    color: Colors.accent,
    fontSize: 15,
    fontWeight: '600' as const,
  },
  marriageInfoRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 6,
    backgroundColor: 'rgba(200, 149, 108, 0.06)',
    borderRadius: 8,
    marginTop: -2,
  },
  marriageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 4,
  },
  marriageMoreBtn: {
    padding: 6,
    marginBottom: 6,
    marginTop: -2,
  },
  marriageInfoText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
  },
  menuOptionDestructive: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.card,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  menuOptionTitleDestructive: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.danger,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end' as const,
  },
  menuSheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 34,
    paddingHorizontal: 20,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 16,
    textAlign: 'center' as const,
  },
  menuOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.card,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  menuOptionTextWrap: {
    flex: 1,
  },
  menuOptionTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  menuOptionDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  menuCancel: {
    alignItems: 'center' as const,
    paddingVertical: 14,
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: Colors.overlay,
  },
  menuCancelText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
});
