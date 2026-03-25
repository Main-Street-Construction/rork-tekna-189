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
import { Save, X, User, Calendar, MapPin, Briefcase, FileText } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { GedcomIndividual } from '@/types/genealogy';
import { useProfile } from '@/contexts/ProfileContext';

type SexType = 'M' | 'F' | 'U';

export default function EditPersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getPerson, updatePerson, isAdmin, submitEdit } = useFamilyTree();
  const { profile } = useProfile();
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const person = useMemo(() => {
    if (!id) return undefined;
    return getPerson(id);
  }, [id, getPerson]);

  const existingGiven = person?.givenName ?? '';
  const givenParts = existingGiven.split(' ');
  const [givenName, setGivenName] = useState<string>(givenParts[0] ?? '');
  const [middleName, setMiddleName] = useState<string>(givenParts.slice(1).join(' '));
  const [surname, setSurname] = useState<string>(person?.surname ?? '');
  const [sex, setSex] = useState<SexType>(person?.sex ?? 'U');
  const [birthDate, setBirthDate] = useState<string>(person?.birthDate ?? '');
  const [birthPlace, setBirthPlace] = useState<string>(person?.birthPlace ?? '');
  const [deathDate, setDeathDate] = useState<string>(person?.deathDate ?? '');
  const [deathPlace, setDeathPlace] = useState<string>(person?.deathPlace ?? '');
  const [occupation, setOccupation] = useState<string>(person?.occupation ?? '');
  const [note, setNote] = useState<string>(person?.note ?? '');

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleSave = useCallback(async () => {
    if (!person || !id) return;

    const trimmedGiven = givenName.trim();
    const trimmedSurname = surname.trim();

    if (!trimmedGiven && !trimmedSurname) {
      Alert.alert('Missing Name', 'Please enter at least a first or last name.');
      return;
    }

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const fullName = [trimmedGiven, trimmedSurname].filter(Boolean).join(' ');
      const givenWithMiddle = [trimmedGiven, middleName.trim()].filter(Boolean).join(' ');
      const fullNameDisplay = [givenWithMiddle, trimmedSurname].filter(Boolean).join(' ');

      const updated: GedcomIndividual = {
        ...person,
        givenName: givenWithMiddle,
        surname: trimmedSurname,
        name: fullNameDisplay,
        sex,
        birthDate: birthDate.trim() || undefined,
        birthPlace: birthPlace.trim() || undefined,
        deathDate: deathDate.trim() || undefined,
        deathPlace: deathPlace.trim() || undefined,
        occupation: occupation.trim() || undefined,
        note: note.trim() || undefined,
      };

      const needsApproval = !isAdmin;

      if (needsApproval) {
        const result = await submitEdit('update_person', updated.id, { individual: updated });
        if (result.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Edit Submitted',
            'Your changes have been submitted for admin review.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        } else {
          Alert.alert('Error', result.error ?? 'Failed to submit edit for review.');
        }
      } else {
        const result = await updatePerson(updated);
        if (result.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        } else {
          Alert.alert('Error', result.error ?? 'Failed to save changes.');
        }
      }
    } catch (e) {
      console.error('[EditPerson] Save error:', e);
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setIsSaving(false);
    }
  }, [person, id, givenName, middleName, surname, sex, birthDate, birthPlace, deathDate, deathPlace, occupation, note, updatePerson, router, isAdmin, submitEdit]);

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
          title: 'Edit Person',
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
                  <Save size={16} color={Colors.white} />
                  <Text style={styles.saveBtnText}>Save</Text>
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
                    testID="edit-given-name"
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
                    testID="edit-middle-name"
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
                testID="edit-surname"
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
                testID="edit-birth-date"
              />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Place</Text>
              <TextInput
                style={styles.input}
                value={birthPlace}
                onChangeText={setBirthPlace}
                placeholder="e.g. New York, USA"
                placeholderTextColor={Colors.textLight}
                testID="edit-birth-place"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Calendar size={16} color={Colors.textSecondary} />
                <Text style={styles.sectionTitle}>Death</Text>
              </View>
              <Text style={styles.fieldLabel}>Date</Text>
              <TextInput
                style={styles.input}
                value={deathDate}
                onChangeText={setDeathDate}
                placeholder="e.g. 3 MAR 1995"
                placeholderTextColor={Colors.textLight}
                testID="edit-death-date"
              />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Place</Text>
              <TextInput
                style={styles.input}
                value={deathPlace}
                onChangeText={setDeathPlace}
                placeholder="e.g. Los Angeles, USA"
                placeholderTextColor={Colors.textLight}
                testID="edit-death-place"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Briefcase size={16} color={Colors.accent} />
                <Text style={styles.sectionTitle}>Occupation</Text>
              </View>
              <TextInput
                style={styles.input}
                value={occupation}
                onChangeText={setOccupation}
                placeholder="e.g. Farmer, Teacher"
                placeholderTextColor={Colors.textLight}
                testID="edit-occupation"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <FileText size={16} color={Colors.accent} />
                <Text style={styles.sectionTitle}>Notes</Text>
              </View>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={note}
                onChangeText={setNote}
                placeholder="Additional notes..."
                placeholderTextColor={Colors.textLight}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                testID="edit-note"
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
  avatarSection: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 8,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: Colors.white,
    fontSize: 22,
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
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
});
