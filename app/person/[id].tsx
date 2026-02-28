import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import {
  MapPin,
  Calendar,
  Briefcase,
  Users,
  ArrowLeft,
  GitBranch,
  ChevronUp,
  Heart,
  ChevronDown,
  FileText,
  Pencil,
  UserPlus,
  HeartHandshake,
  Link,
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
import { GedcomIndividual, GedcomFamily } from '@/types/genealogy';

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { treeData, getPerson } = useFamilyTree();
  const { profile } = useProfile();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

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

  const handlePersonPress = useCallback(
    (p: { id: string }) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push(`/person/${p.id}`);
    },
    [router]
  );

  const handleEdit = useCallback(() => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/edit-person/${id}`);
  }, [id, router]);

  const handleAddChild = useCallback(() => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/add-child/${id}`);
  }, [id, router]);

  const handleAddSpouse = useCallback(() => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/add-spouse/${id}`);
  }, [id, router]);

  const handleEditMarriage = useCallback((familyId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/edit-marriage/${familyId}`);
  }, [router]);

  const handleLinkSpouses = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/link-spouses');
  }, [router]);

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
            onPress={() => router.back()}
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

  const renderMiniTreeNode = (
    p: GedcomIndividual,
    label: string,
    isCenter?: boolean
  ) => {
    const color =
      p.sex === 'F' ? Colors.female : p.sex === 'M' ? Colors.male : Colors.textSecondary;
    const ini = (p.givenName?.[0] ?? '') + (p.surname?.[0] ?? '');
    return (
      <TouchableOpacity
        key={p.id}
        style={[styles.treeNode, isCenter && styles.treeNodeCenter]}
        onPress={() => handlePersonPress(p)}
        activeOpacity={0.7}
      >
        <View style={[styles.treeNodeAvatar, { backgroundColor: color }]}>
          <Text style={styles.treeNodeAvatarText}>{ini}</Text>
        </View>
        <Text style={styles.treeNodeName} numberOfLines={1}>
          {p.givenName}
        </Text>
        <Text style={styles.treeNodeLabel}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const hasTreeData =
    parents.length > 0 || spouses.length > 0 || children.length > 0;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: person.name,
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false,
          headerRight: () => (
            <TouchableOpacity onPress={handleEdit} style={styles.editHeaderBtn}>
              <Pencil size={18} color={Colors.accent} />
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

          {hasTreeData && (
            <View style={styles.miniTreeSection}>
              <SectionHeader title="Family Tree" />
              <View style={styles.miniTree}>
                {grandparents.length > 0 && (
                  <>
                    <View style={styles.treeRow}>
                      {grandparents.map((gp) =>
                        renderMiniTreeNode(
                          gp,
                          gp.sex === 'F' ? 'Grandmother' : 'Grandfather'
                        )
                      )}
                    </View>
                    <View style={styles.treeConnectorDown}>
                      <ChevronDown size={16} color={Colors.cardBorder} />
                    </View>
                  </>
                )}

                {parents.length > 0 && (
                  <>
                    <View style={styles.treeRow}>
                      {parents.map((p) =>
                        renderMiniTreeNode(
                          p,
                          p.sex === 'F' ? 'Mother' : 'Father'
                        )
                      )}
                    </View>
                    <View style={styles.treeConnectorDown}>
                      <ChevronDown size={16} color={Colors.cardBorder} />
                    </View>
                  </>
                )}

                <View style={styles.treeRow}>
                  <View style={[styles.treeCenterNode]}>
                    <View
                      style={[
                        styles.treeCenterAvatar,
                        { backgroundColor: genderColor },
                      ]}
                    >
                      <Text style={styles.treeCenterAvatarText}>
                        {initials}
                      </Text>
                    </View>
                    <Text style={styles.treeCenterName} numberOfLines={1}>
                      {person.givenName}
                    </Text>
                  </View>
                  {spouses.length > 0 && (
                    <>
                      <View style={styles.spouseConnector}>
                        <Heart size={12} color={Colors.accent} />
                      </View>
                      {spouses.map((s) =>
                        renderMiniTreeNode(
                          s,
                          s.sex === 'F' ? 'Wife' : 'Husband'
                        )
                      )}
                    </>
                  )}
                </View>

                {children.length > 0 && (
                  <>
                    <View style={styles.treeConnectorDown}>
                      <ChevronDown size={16} color={Colors.cardBorder} />
                    </View>
                    <View style={styles.treeRow}>
                      {children.slice(0, 5).map((c) =>
                        renderMiniTreeNode(
                          c,
                          c.sex === 'F' ? 'Daughter' : 'Son'
                        )
                      )}
                      {children.length > 5 && (
                        <View style={styles.treeMoreNode}>
                          <Text style={styles.treeMoreText}>
                            +{children.length - 5}
                          </Text>
                        </View>
                      )}
                    </View>
                  </>
                )}
              </View>
            </View>
          )}

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
                {children.map((c) => (
                  <PersonCard
                    key={c.id}
                    person={c}
                    onPress={handlePersonPress}
                    subtitle={c.sex === 'F' ? 'Daughter' : 'Son'}
                    compact
                  />
                ))}
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

          {person.note && (
            <View style={styles.notesSection}>
              <SectionHeader title="Notes" />
              <View style={styles.notesCard}>
                <FileText size={16} color={Colors.accent} style={{ marginTop: 2 }} />
                <Text style={styles.notesText}>{person.note}</Text>
              </View>
            </View>
          )}

          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleEdit} activeOpacity={0.7}>
              <Pencil size={18} color={Colors.white} />
              <Text style={styles.actionBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addChildBtn} onPress={handleAddChild} activeOpacity={0.7}>
              <UserPlus size={18} color={Colors.accent} />
              <Text style={styles.addChildBtnText}>Child</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addChildBtn} onPress={handleAddSpouse} activeOpacity={0.7}>
              <HeartHandshake size={18} color={Colors.accent} />
              <Text style={styles.addChildBtnText}>Spouse</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.linkSpousesBtn} onPress={handleLinkSpouses} activeOpacity={0.7}>
            <Link size={16} color={Colors.accent} />
            <Text style={styles.linkSpousesBtnText}>Link Existing People as Spouses</Text>
          </TouchableOpacity>
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
  miniTreeSection: {
    marginTop: 16,
  },
  miniTree: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignItems: 'center',
  },
  treeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  treeConnectorDown: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
  },
  treeNode: {
    alignItems: 'center',
    width: 60,
  },
  treeNodeCenter: {
    borderWidth: 2,
    borderColor: Colors.accent,
    borderRadius: 12,
    padding: 6,
  },
  treeNodeAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  treeNodeAvatarText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  treeNodeName: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'center',
  },
  treeNodeLabel: {
    fontSize: 9,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 1,
  },
  treeCenterNode: {
    alignItems: 'center',
    backgroundColor: 'rgba(200, 149, 108, 0.08)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 2,
    borderColor: Colors.accent,
  },
  treeCenterAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  treeCenterAvatarText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  treeCenterName: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.accent,
    textAlign: 'center',
  },
  spouseConnector: {
    paddingHorizontal: 4,
  },
  treeMoreNode: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  treeMoreText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
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
  editHeaderBtn: {
    padding: 6,
  },
  actionButtons: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 24,
    gap: 12,
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
  marriageInfoText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
  },
  linkSpousesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  linkSpousesBtnText: {
    fontSize: 14,
    color: Colors.accent,
    fontWeight: '500' as const,
  },
});
