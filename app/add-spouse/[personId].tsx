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
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Heart, X, User, Calendar, MapPin } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { GedcomIndividual } from '@/types/genealogy';

type SexType = 'M' | 'F' | 'U';

export default function AddSpouseScreen() {
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const router = useRouter();
  const {
    getPerson,
    generateNewId,
    addSpouse,
    isAdmin,
    submitEdit,
  } = useFamilyTree();

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const person = useMemo(() => {
    if (!personId) return undefined;
    return getPerson(personId);
  }, [personId, getPerson]);

  const defaultSex: SexType = person?.sex === 'M' ? 'F' : person?.sex === 'F' ? 'M' : 'U';

  const [givenName, setGivenName] = useState<string>('');
  const [middleName, setMiddleName] = useState<string>('');
  const [surname, setSurname] = useState<string>('');
  const [sex, setSex] = useState<SexType>(defaultSex);
  const [birthDate, setBirthDate] = useState<string>('');
  const [birthPlace, setBirthPlace] = useState<string>('');
  const [marriageDate, setMarriageDate] = useState<string>('');
  const [marriagePlace, setMarriagePlace] = useState<string>('');

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleSave = useCallback(async () => {
    if (!person || !personId) return;

    const trimmedGiven = givenName.trim();
    const trimmedMiddle = middleName.trim();
    const trimmedSurname = surname.trim();

    if (!trimmedGiven) {
      Alert.alert('Missing Name', 'Please enter at least a first name.');
      return;
    }

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const newId = generateNewId('I');
      const givenWithMiddle = [trimmedGiven, trimmedMiddle].filter(Boolean).join(' ');
      const fullName = [givenWithMiddle, trimmedSurname].filter(Boolean).join(' ');

      const newSpouse: GedcomIndividual = {
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
          spouse: newSpouse,
          personId,
          marriageDate: marriageDate.trim() || undefined,
          marriagePlace: marriagePlace.trim() || undefined,
        };
        const result = await submitEdit('add_spouse', newSpouse.id, editData);
        if (result.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Edit Submitted',
            'Your request to add a spouse has been submitted for admin review.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        } else {
          Alert.alert('Error', result.error ?? 'Failed to submit for review.');
        }
      } else {
        const result = await addSpouse(
          personId,
          newSpouse,
          marriageDate.trim() || undefined,
          marriagePlace.trim() || undefined
        );

        if (result.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        } else {
          Alert.alert('Error', result.error ?? 'Failed to add spouse.');
        }
      }
    } catch (e) {
      console.error('[AddSpouse] Save error:', e);
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setIsSaving(false);
    }
  }, [person, personId, givenName, middleName, surname, sex, birthDate, birthPlace, marriageDate, marriagePlace, generateNewId, addSpouse, router, isAdmin, submitEdit]);

  if (!person) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <View style={styles.centerMessage}>
          <Text style={styles.errorText}>Person not found</Text>
        </View>
      </View>
    );
  }

  const genderColor = sex === 'F' ? Colors.female : sex === 'M' ? Colors.male : Colors.textSecondary;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Add Spouse',
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
                  <Heart size={16} color={Colors.white} />
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
              <Text style={styles.parentLabel}>Adding spouse of</Text>
              <View style={styles.parentBadge}>
                <View style={[styles.parentAvatar, {
                  backgroundColor: person.sex === 'F' ? Colors.female : person.sex === 'M' ? Colors.male : Colors.textSecondary
                }]}>
                  <Text style={styles.parentAvatarText}>
                    {(person.givenName?.[0] ?? '') + (person.surname?.[0] ?? '')}
                  </Text>
                </View>
                <Text style={styles.parentName}>{person.name}</Text>
              </View>
            </View>

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
                    testID="add-spouse-given-name"
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
                    testID="add-spouse-middle-name"
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
                testID="add-spouse-surname"
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
                testID="add-spouse-birth-date"
              />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Place</Text>
              <TextInput
                style={styles.input}
                value={birthPlace}
                onChangeText={setBirthPlace}
                placeholder="e.g. New York, USA"
                placeholderTextColor={Colors.textLight}
                testID="add-spouse-birth-place"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Heart size={16} color={Colors.accent} />
                <Text style={styles.sectionTitle}>Marriage</Text>
              </View>
              <Text style={styles.fieldLabel}>Date</Text>
              <TextInput
                style={styles.input}
                value={marriageDate}
                onChangeText={setMarriageDate}
                placeholder="e.g. 10 JUN 1945"
                placeholderTextColor={Colors.textLight}
                testID="add-spouse-marriage-date"
              />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Place</Text>
              <TextInput
                style={styles.input}
                value={marriagePlace}
                onChangeText={setMarriagePlace}
                placeholder="e.g. Springfield, OH"
                placeholderTextColor={Colors.textLight}
                testID="add-spouse-marriage-place"
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
