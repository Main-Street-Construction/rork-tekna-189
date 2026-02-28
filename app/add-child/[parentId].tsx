import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
  FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { UserPlus, X, User, Calendar, MapPin, Search, Check, Users } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { GedcomIndividual } from '@/types/genealogy';
import { getSpouses, getChildren } from '@/utils/gedcom-parser';
import { useProfile } from '@/contexts/ProfileContext';

type SexType = 'M' | 'F' | 'U';

export default function AddChildScreen() {
  const { parentId } = useLocalSearchParams<{ parentId: string }>();
  const router = useRouter();
  const {
    treeData,
    getPerson,
    generateNewId,
    addChildToFamily,
    createFamilyAndAddChild,
    search,
    isAdmin,
    submitEdit,
  } = useFamilyTree();
  const { profile } = useProfile();

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const parent = useMemo(() => {
    if (!parentId) return undefined;
    return getPerson(parentId);
  }, [parentId, getPerson]);

  const spouses = useMemo(() => {
    if (!parentId || !treeData) return [];
    return getSpouses(parentId, treeData);
  }, [parentId, treeData]);

  const existingFamilies = useMemo(() => {
    if (!parent || !treeData) return [];
    return parent.familiesAsSpouse
      .map((fid) => treeData.families.get(fid))
      .filter((f): f is NonNullable<typeof f> => f != null);
  }, [parent, treeData]);

  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(
    existingFamilies.length === 1 ? existingFamilies[0].id : null
  );
  const [selectedSpouseId, setSelectedSpouseId] = useState<string | null>(
    spouses.length === 1 ? spouses[0].id : null
  );

  const [givenName, setGivenName] = useState<string>('');
  const [middleName, setMiddleName] = useState<string>('');
  const [surname, setSurname] = useState<string>(parent?.surname ?? '');
  const [sex, setSex] = useState<SexType>('U');
  const [birthDate, setBirthDate] = useState<string>('');
  const [birthPlace, setBirthPlace] = useState<string>('');

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const getFamilyLabel = useCallback(
    (famId: string): string => {
      if (!treeData) return famId;
      const fam = treeData.families.get(famId);
      if (!fam) return famId;
      const h = fam.husbandId ? getPerson(fam.husbandId) : undefined;
      const w = fam.wifeId ? getPerson(fam.wifeId) : undefined;
      const parts: string[] = [];
      if (h) parts.push(h.givenName || h.name);
      if (w) parts.push(w.givenName || w.name);
      const kids = fam.childrenIds.length;
      return `${parts.join(' & ')}${kids > 0 ? ` (${kids} children)` : ''}`;
    },
    [treeData, getPerson]
  );

  const handleSave = useCallback(async () => {
    if (!parent || !parentId) return;

    const trimmedGiven = givenName.trim();
    const trimmedSurname = surname.trim();

    if (!trimmedGiven) {
      Alert.alert('Missing Name', 'Please enter at least a first name.');
      return;
    }

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const newId = generateNewId('I');
      const fullName = [trimmedGiven, middleName.trim(), trimmedSurname].filter(Boolean).join(' ');

      const givenWithMiddle = [trimmedGiven, middleName.trim()].filter(Boolean).join(' ');

      const newChild: GedcomIndividual = {
        id: newId,
        name: fullName,
        givenName: givenWithMiddle,
        surname: trimmedSurname,
        sex,
        birthDate: birthDate.trim() || undefined,
        birthPlace: birthPlace.trim() || undefined,
        familiesAsSpouse: [],
        familyAsChild: undefined,
      };

      const needsApproval = !isAdmin;

      if (needsApproval) {
        const editData: Record<string, unknown> = {
          child: newChild,
          parentId,
          familyId: selectedFamilyId ?? undefined,
          spouseId: selectedSpouseId ?? undefined,
        };
        const result = await submitEdit('add_child', newChild.id, editData);
        if (result.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Edit Submitted',
            'Your request to add a child has been submitted for admin review.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        } else {
          Alert.alert('Error', result.error ?? 'Failed to submit for review.');
        }
      } else {
        let result: { success: boolean; error?: string };

        if (selectedFamilyId) {
          result = await addChildToFamily(newChild, selectedFamilyId);
        } else {
          const famResult = await createFamilyAndAddChild(
            newChild,
            parentId,
            selectedSpouseId ?? undefined
          );
          result = { success: famResult.success, error: famResult.error };
        }

        if (result.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        } else {
          Alert.alert('Error', result.error ?? 'Failed to add child.');
        }
      }
    } catch (e) {
      console.error('[AddChild] Save error:', e);
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setIsSaving(false);
    }
  }, [parent, parentId, givenName, middleName, surname, sex, birthDate, birthPlace, selectedFamilyId, selectedSpouseId, generateNewId, addChildToFamily, createFamilyAndAddChild, router, isAdmin, submitEdit]);

  if (!parent) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <View style={styles.centerMessage}>
          <Text style={styles.errorText}>Parent not found</Text>
        </View>
      </View>
    );
  }

  const genderColor = sex === 'F' ? Colors.female : sex === 'M' ? Colors.male : Colors.textSecondary;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Add Child',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
              <X size={22} color={Colors.text} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving}
              style={[styles.saveBtn, isSaving && { opacity: 0.5 }]}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <UserPlus size={16} color={Colors.white} />
                  <Text style={styles.saveBtnText}>Add</Text>
                </>
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={100}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.parentInfo}>
              <Text style={styles.parentLabel}>Adding child of</Text>
              <View style={styles.parentBadge}>
                <View style={[styles.parentAvatar, {
                  backgroundColor: parent.sex === 'F' ? Colors.female : parent.sex === 'M' ? Colors.male : Colors.textSecondary
                }]}>
                  <Text style={styles.parentAvatarText}>
                    {(parent.givenName?.[0] ?? '') + (parent.surname?.[0] ?? '')}
                  </Text>
                </View>
                <Text style={styles.parentName}>{parent.name}</Text>
              </View>
            </View>

            {existingFamilies.length > 1 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Users size={16} color={Colors.accent} />
                  <Text style={styles.sectionTitle}>Select Family</Text>
                </View>
                <Text style={styles.hint}>
                  This parent belongs to multiple families. Choose which one the child belongs to.
                </Text>
                {existingFamilies.map((fam) => (
                  <TouchableOpacity
                    key={fam.id}
                    style={[
                      styles.familyOption,
                      selectedFamilyId === fam.id && styles.familyOptionSelected,
                    ]}
                    onPress={() => {
                      setSelectedFamilyId(fam.id);
                      Haptics.selectionAsync();
                    }}
                  >
                    <Text style={[
                      styles.familyOptionText,
                      selectedFamilyId === fam.id && styles.familyOptionTextSelected,
                    ]}>
                      {getFamilyLabel(fam.id)}
                    </Text>
                    {selectedFamilyId === fam.id && (
                      <Check size={18} color={Colors.accent} />
                    )}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[
                    styles.familyOption,
                    selectedFamilyId === null && styles.familyOptionSelected,
                  ]}
                  onPress={() => {
                    setSelectedFamilyId(null);
                    Haptics.selectionAsync();
                  }}
                >
                  <Text style={[
                    styles.familyOptionText,
                    selectedFamilyId === null && styles.familyOptionTextSelected,
                  ]}>
                    Create new family
                  </Text>
                  {selectedFamilyId === null && (
                    <Check size={18} color={Colors.accent} />
                  )}
                </TouchableOpacity>
              </View>
            )}

            {existingFamilies.length <= 1 && spouses.length > 1 && !selectedFamilyId && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Users size={16} color={Colors.accent} />
                  <Text style={styles.sectionTitle}>Other Parent</Text>
                </View>
                {spouses.map((sp) => (
                  <TouchableOpacity
                    key={sp.id}
                    style={[
                      styles.familyOption,
                      selectedSpouseId === sp.id && styles.familyOptionSelected,
                    ]}
                    onPress={() => {
                      setSelectedSpouseId(sp.id);
                      Haptics.selectionAsync();
                    }}
                  >
                    <Text style={[
                      styles.familyOptionText,
                      selectedSpouseId === sp.id && styles.familyOptionTextSelected,
                    ]}>
                      {sp.name}
                    </Text>
                    {selectedSpouseId === sp.id && (
                      <Check size={18} color={Colors.accent} />
                    )}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[
                    styles.familyOption,
                    selectedSpouseId === null && styles.familyOptionSelected,
                  ]}
                  onPress={() => {
                    setSelectedSpouseId(null);
                    Haptics.selectionAsync();
                  }}
                >
                  <Text style={[
                    styles.familyOptionText,
                    selectedSpouseId === null && styles.familyOptionTextSelected,
                  ]}>
                    No other parent
                  </Text>
                  {selectedSpouseId === null && (
                    <Check size={18} color={Colors.accent} />
                  )}
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.avatarSection}>
              <View style={[styles.avatar, { backgroundColor: genderColor }]}>
                <Text style={styles.avatarText}>
                  {(givenName?.[0] ?? '') + (surname?.[0] ?? '') || '?'}
                </Text>
              </View>
            </View>

            <View style={styles.sexPicker}>
              {(['M', 'F', 'U'] as SexType[]).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.sexOption,
                    sex === s && styles.sexOptionActive,
                    sex === s && s === 'M' && { backgroundColor: Colors.male },
                    sex === s && s === 'F' && { backgroundColor: Colors.female },
                    sex === s && s === 'U' && { backgroundColor: Colors.textSecondary },
                  ]}
                  onPress={() => {
                    setSex(s);
                    Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.sexOptionText, sex === s && styles.sexOptionTextActive]}>
                    {s === 'M' ? 'Male' : s === 'F' ? 'Female' : 'Unknown'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <User size={16} color={Colors.accent} />
                <Text style={styles.sectionTitle}>Name</Text>
              </View>
              <View style={styles.fieldRow}>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>First Name</Text>
                  <TextInput
                    style={styles.input}
                    value={givenName}
                    onChangeText={setGivenName}
                    placeholder="First name"
                    placeholderTextColor={Colors.textLight}
                    autoCapitalize="words"
                    autoFocus
                    testID="add-child-given-name"
                  />
                </View>
                <View style={styles.fieldHalf}>
                  <Text style={styles.fieldLabel}>Middle Name</Text>
                  <TextInput
                    style={styles.input}
                    value={middleName}
                    onChangeText={setMiddleName}
                    placeholder="Middle name"
                    placeholderTextColor={Colors.textLight}
                    autoCapitalize="words"
                    testID="add-child-middle-name"
                  />
                </View>
              </View>
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Last Name</Text>
              <TextInput
                style={styles.input}
                value={surname}
                onChangeText={setSurname}
                placeholder="Last name"
                placeholderTextColor={Colors.textLight}
                autoCapitalize="words"
                testID="add-child-surname"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Calendar size={16} color={Colors.accent} />
                <Text style={styles.sectionTitle}>Birth</Text>
              </View>
              <Text style={styles.fieldLabel}>Date</Text>
              <TextInput
                style={styles.input}
                value={birthDate}
                onChangeText={setBirthDate}
                placeholder="e.g. 15 JAN 1920"
                placeholderTextColor={Colors.textLight}
                testID="add-child-birth-date"
              />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Place</Text>
              <TextInput
                style={styles.input}
                value={birthPlace}
                onChangeText={setBirthPlace}
                placeholder="e.g. New York, USA"
                placeholderTextColor={Colors.textLight}
                testID="add-child-birth-place"
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
    paddingBottom: 60,
  },
  centerMessage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  headerBtn: {
    padding: 4,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    gap: 6,
  },
  saveBtnText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  parentInfo: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  parentLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  parentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  parentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  parentAvatarText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  parentName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  hint: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },
  familyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  familyOptionSelected: {
    borderColor: Colors.accent,
    backgroundColor: 'rgba(200, 149, 108, 0.08)',
  },
  familyOptionText: {
    fontSize: 14,
    color: Colors.text,
    flex: 1,
  },
  familyOptionTextSelected: {
    fontWeight: '600' as const,
    color: Colors.accent,
  },
  avatarSection: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: Colors.white,
    fontSize: 20,
    fontWeight: '700' as const,
  },
  sexPicker: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    gap: 8,
  },
  sexOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignItems: 'center',
  },
  sexOptionActive: {
    borderColor: 'transparent',
  },
  sexOptionText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  sexOptionTextActive: {
    color: Colors.white,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  fieldHalf: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
});
