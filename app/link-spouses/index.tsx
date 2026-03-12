import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
  FlatList,
  Keyboard,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import { Heart, X, Search, User, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { GedcomIndividual } from '@/types/genealogy';

type SelectionStep = 'person1' | 'person2' | 'details';

export default function LinkSpousesScreen() {
  const router = useRouter();
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const { search, getPerson, isAdmin, submitEdit, linkExistingSpouses } = useFamilyTree();

  const [step, setStep] = useState<SelectionStep>('person1');
  const [person1, setPerson1] = useState<GedcomIndividual | null>(null);
  const [didPrefill, setDidPrefill] = useState<boolean>(false);
  const [person2, setPerson2] = useState<GedcomIndividual | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<GedcomIndividual[]>([]);
  const [marriageDate, setMarriageDate] = useState<string>('');
  const [marriagePlace, setMarriagePlace] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prefill && !didPrefill) {
      const prefillPerson = getPerson(prefill);
      if (prefillPerson) {
        setPerson1(prefillPerson);
        setStep('person2');
        setDidPrefill(true);
      }
    }
  }, [prefill, didPrefill, getPerson]);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
      if (text.trim().length >= 2) {
        searchTimerRef.current = setTimeout(() => {
          const found = search(text);
          const filtered = step === 'person2' && person1
            ? found.filter((p) => p.id !== person1.id)
            : found;
          setSearchResults(filtered.slice(0, 30));
        }, 250);
      } else {
        searchTimerRef.current = null;
        setSearchResults([]);
      }
    },
    [search, step, person1]
  );

  const handleSelectPerson = useCallback(
    (person: GedcomIndividual) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Keyboard.dismiss();
      if (step === 'person1') {
        setPerson1(person);
        setStep('person2');
        setSearchQuery('');
        setSearchResults([]);
      } else if (step === 'person2') {
        setPerson2(person);
        setStep('details');
        setSearchQuery('');
        setSearchResults([]);
      }
    },
    [step]
  );

  const handleSave = useCallback(async () => {
    if (!person1 || !person2) return;

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (isAdmin) {
        const result = await linkExistingSpouses(
          person1.id,
          person2.id,
          marriageDate.trim() || undefined,
          marriagePlace.trim() || undefined
        );
        if (result.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Success', 'Marriage relationship created.', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        } else {
          Alert.alert('Error', result.error ?? 'Failed to link spouses.');
        }
      } else {
        const editData: Record<string, unknown> = {
          person1Id: person1.id,
          person1Name: person1.name,
          person2Id: person2.id,
          person2Name: person2.name,
          marriageDate: marriageDate.trim() || undefined,
          marriagePlace: marriagePlace.trim() || undefined,
        };
        const result = await submitEdit('link_spouses', person1.id, editData);
        if (result.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            'Edit Submitted',
            'Your request to link these spouses has been submitted for admin review.',
            [{ text: 'OK', onPress: () => router.back() }]
          );
        } else {
          Alert.alert('Error', result.error ?? 'Failed to submit for review.');
        }
      }
    } catch (e) {
      console.error('[LinkSpouses] Save error:', e);
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setIsSaving(false);
    }
  }, [person1, person2, marriageDate, marriagePlace, isAdmin, linkExistingSpouses, submitEdit, router]);

  const stepTitle = useMemo(() => {
    if (step === 'person1') return 'Select First Person';
    if (step === 'person2') return 'Select Second Person';
    return 'Marriage Details';
  }, [step]);

  const renderPersonResult = useCallback(({ item }: { item: GedcomIndividual }) => {
    const genderColor = item.sex === 'F' ? Colors.female : item.sex === 'M' ? Colors.male : Colors.textSecondary;
    const initials = (item.givenName?.[0] ?? '') + (item.surname?.[0] ?? '');
    return (
      <TouchableOpacity
        style={styles.resultItem}
        onPress={() => handleSelectPerson(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.resultAvatar, { backgroundColor: genderColor }]}>
          <Text style={styles.resultAvatarText}>{initials || '?'}</Text>
        </View>
        <View style={styles.resultInfo}>
          <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
          {item.birthDate && (
            <Text style={styles.resultMeta}>b. {item.birthDate}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [handleSelectPerson]);

  const renderSelectedBadge = (person: GedcomIndividual, label: string, onClear: () => void) => {
    const genderColor = person.sex === 'F' ? Colors.female : person.sex === 'M' ? Colors.male : Colors.textSecondary;
    const initials = (person.givenName?.[0] ?? '') + (person.surname?.[0] ?? '');
    return (
      <View style={styles.selectedBadge}>
        <Text style={styles.selectedLabel}>{label}</Text>
        <View style={styles.selectedCard}>
          <View style={[styles.selectedAvatar, { backgroundColor: genderColor }]}>
            <Text style={styles.selectedAvatarText}>{initials || '?'}</Text>
          </View>
          <View style={styles.selectedInfo}>
            <Text style={styles.selectedName}>{person.name}</Text>
            {person.birthDate && <Text style={styles.selectedMeta}>b. {person.birthDate}</Text>}
          </View>
          <TouchableOpacity onPress={onClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={16} color={Colors.textLight} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Link Spouses',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
              <X size={22} color={Colors.text} />
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={100}
      >
        {step !== 'details' ? (
          <View style={{ flex: 1 }}>
            {person1 && (
              renderSelectedBadge(person1, 'Person 1', () => {
                setPerson1(null);
                setPerson2(null);
                setStep('person1');
                setSearchQuery('');
                setSearchResults([]);
              })
            )}

            <View style={styles.searchSection}>
              <Text style={styles.stepTitle}>{stepTitle}</Text>
              <View style={styles.searchBar}>
                <Search size={18} color={Colors.textLight} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by name..."
                  placeholderTextColor={Colors.textLight}
                  value={searchQuery}
                  onChangeText={handleSearch}
                  autoCorrect={false}
                  autoFocus
                  testID="link-spouse-search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <View style={styles.clearBtn}>
                      <X size={12} color={Colors.white} />
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                renderItem={renderPersonResult}
                contentContainerStyle={styles.resultsList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              />
            ) : searchQuery.length >= 2 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No results found</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <User size={24} color={Colors.textLight} />
                <Text style={styles.emptyText}>Search for a person to select</Text>
              </View>
            )}
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.detailsContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {person1 && renderSelectedBadge(person1, 'Person 1', () => {
              setPerson1(null);
              setPerson2(null);
              setStep('person1');
            })}

            <View style={styles.heartConnector}>
              <Heart size={20} color={Colors.accent} />
            </View>

            {person2 && renderSelectedBadge(person2, 'Person 2', () => {
              setPerson2(null);
              setStep('person2');
              setSearchQuery('');
              setSearchResults([]);
            })}

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Heart size={16} color={Colors.accent} />
                <Text style={styles.sectionTitle}>Marriage Details</Text>
              </View>
              <Text style={styles.fieldLabel}>Date</Text>
              <TextInput
                style={styles.input}
                value={marriageDate}
                onChangeText={setMarriageDate}
                placeholder="e.g. 10 JUN 1945"
                placeholderTextColor={Colors.textLight}
                testID="link-spouse-marriage-date"
              />
              <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Place</Text>
              <TextInput
                style={styles.input}
                value={marriagePlace}
                onChangeText={setMarriagePlace}
                placeholder="e.g. Springfield, OH"
                placeholderTextColor={Colors.textLight}
                testID="link-spouse-marriage-place"
              />
            </View>

            <TouchableOpacity
              style={[styles.saveButton, isSaving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={isSaving}
              activeOpacity={0.7}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <Check size={18} color={Colors.white} />
                  <Text style={styles.saveButtonText}>
                    {isAdmin ? 'Create Marriage Link' : 'Submit for Review'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerBtn: {
    padding: 4,
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    marginLeft: 10,
    height: 48,
  },
  clearBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.textLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultsList: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 12,
  },
  resultAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultAvatarText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  resultMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 60,
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  selectedBadge: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  selectedLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.accent,
    gap: 12,
  },
  selectedAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedAvatarText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  selectedInfo: {
    flex: 1,
  },
  selectedName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  selectedMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  heartConnector: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  detailsContent: {
    paddingBottom: 40,
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
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600' as const,
  },
});
