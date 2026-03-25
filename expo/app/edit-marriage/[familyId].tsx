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
import { Save, X, Heart, Calendar, MapPin } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { GedcomFamily } from '@/types/genealogy';

export default function EditMarriageScreen() {
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const router = useRouter();
  const { treeData, updateFamily, isAdmin, submitEdit, getPerson } = useFamilyTree();
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const family = useMemo(() => {
    if (!familyId || !treeData) return undefined;
    return treeData.families.get(familyId);
  }, [familyId, treeData]);

  const husband = useMemo(() => {
    if (!family?.husbandId) return undefined;
    return getPerson(family.husbandId);
  }, [family, getPerson]);

  const wife = useMemo(() => {
    if (!family?.wifeId) return undefined;
    return getPerson(family.wifeId);
  }, [family, getPerson]);

  const [marriageDate, setMarriageDate] = useState<string>(family?.marriageDate ?? '');
  const [marriagePlace, setMarriagePlace] = useState<string>(family?.marriagePlace ?? '');

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleSave = useCallback(async () => {
    if (!family || !familyId) return;

    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (isAdmin) {
        const updatedFamily: GedcomFamily = {
          ...family,
          marriageDate: marriageDate.trim() || undefined,
          marriagePlace: marriagePlace.trim() || undefined,
        };
        const result = await updateFamily(updatedFamily);
        if (result.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        } else {
          Alert.alert('Error', result.error ?? 'Failed to save changes.');
        }
      } else {
        const editData: Record<string, unknown> = {
          familyId,
          marriageDate: marriageDate.trim() || undefined,
          marriagePlace: marriagePlace.trim() || undefined,
          person1Name: husband?.name ?? 'Unknown',
          person2Name: wife?.name ?? 'Unknown',
        };
        const result = await submitEdit('edit_marriage', familyId, editData);
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
      }
    } catch (e) {
      console.error('[EditMarriage] Save error:', e);
      Alert.alert('Error', 'An unexpected error occurred.');
    } finally {
      setIsSaving(false);
    }
  }, [family, familyId, marriageDate, marriagePlace, isAdmin, updateFamily, submitEdit, router, husband, wife]);

  if (!family) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <View style={styles.centerMessage}>
          <Text style={styles.errorText}>Marriage record not found</Text>
        </View>
      </View>
    );
  }

  const renderPersonBadge = (person: { name: string; sex: string } | undefined, label: string) => {
    if (!person) return null;
    const color = person.sex === 'F' ? Colors.female : person.sex === 'M' ? Colors.male : Colors.textSecondary;
    const initials = person.name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('');
    return (
      <View style={styles.personBadge}>
        <View style={[styles.personAvatar, { backgroundColor: color }]}>
          <Text style={styles.personAvatarText}>{initials || '?'}</Text>
        </View>
        <View style={styles.personInfo}>
          <Text style={styles.personLabel}>{label}</Text>
          <Text style={styles.personName} numberOfLines={1}>{person.name}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Edit Marriage',
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
            <View style={styles.coupleSection}>
              {renderPersonBadge(husband, 'Husband')}
              <View style={styles.heartIcon}>
                <Heart size={20} color={Colors.accent} />
              </View>
              {renderPersonBadge(wife, 'Wife')}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Calendar size={16} color={Colors.accent} />
                <Text style={styles.sectionTitle}>Marriage Date</Text>
              </View>
              <TextInput
                style={styles.input}
                value={marriageDate}
                onChangeText={setMarriageDate}
                placeholder="e.g. 10 JUN 1945"
                placeholderTextColor={Colors.textLight}
                testID="edit-marriage-date"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MapPin size={16} color={Colors.accent} />
                <Text style={styles.sectionTitle}>Marriage Place</Text>
              </View>
              <TextInput
                style={styles.input}
                value={marriagePlace}
                onChangeText={setMarriagePlace}
                placeholder="e.g. Springfield, OH"
                placeholderTextColor={Colors.textLight}
                testID="edit-marriage-place"
              />
            </View>

            {!isAdmin && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Your changes will be submitted for admin review before being applied.
                </Text>
              </View>
            )}
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
  coupleSection: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  personBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 12,
  },
  personAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  personAvatarText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  personInfo: {
    flex: 1,
  },
  personLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  personName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 2,
  },
  heartIcon: {
    paddingVertical: 10,
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
  infoBox: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: 'rgba(200, 149, 108, 0.1)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(200, 149, 108, 0.2)',
  },
  infoText: {
    fontSize: 13,
    color: Colors.accent,
    lineHeight: 19,
    textAlign: 'center',
  },
});
