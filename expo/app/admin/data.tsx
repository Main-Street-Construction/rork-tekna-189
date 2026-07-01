import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack } from 'expo-router';
import { Search, Database, Trash2, Save } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import {
  adminSearchIndividuals,
  adminUpdateIndividual,
  adminDeleteIndividual,
  type AdminIndividualRow,
} from '@/lib/supabase-rpc';
import { getCloudCounts } from '@/lib/supabase-db';

export default function AdminDataScreen() {
  const { isAdmin } = useAuth();
  const { individualCount, familyCount, refreshFromCloud } = useFamilyTree();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminIndividualRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [cloudCounts, setCloudCounts] = useState<{ individuals: number; families: number } | null>(null);
  const [selected, setSelected] = useState<AdminIndividualRow | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const loadCloudCounts = useCallback(async () => {
    const counts = await getCloudCounts();
    if (counts) setCloudCounts(counts);
  }, []);

  React.useEffect(() => {
    if (isAdmin) void loadCloudCounts();
  }, [isAdmin, loadCloudCounts]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    const { rows, error } = await adminSearchIndividuals(query.trim());
    setSearching(false);
    if (error) {
      Alert.alert('Search Error', error);
      return;
    }
    setResults(rows);
  }, [query]);

  const openEdit = (row: AdminIndividualRow) => {
    setSelected(row);
    setEditFields({
      first_name: row.first_name ?? '',
      last_name: row.last_name ?? '',
      gender: row.gender ?? '',
      birth_date: row.birth_date ?? '',
      birth_place: row.birth_place ?? '',
      death_date: row.death_date ?? '',
      death_place: row.death_place ?? '',
      notes: row.notes ?? '',
    });
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    const result = await adminUpdateIndividual(selected.gedcom_id, {
      first_name: editFields.first_name || null,
      last_name: editFields.last_name || null,
      gender: editFields.gender || null,
      birth_date: editFields.birth_date || null,
      birth_place: editFields.birth_place || null,
      death_date: editFields.death_date || null,
      death_place: editFields.death_place || null,
      notes: editFields.notes || null,
    });
    setSaving(false);
    if (!result.success) {
      Alert.alert('Error', result.error ?? 'Save failed');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelected(null);
    void refreshFromCloud();
    void handleSearch();
  };

  const handleDelete = (row: AdminIndividualRow) => {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.gedcom_id;
    Alert.alert('Delete Person', `Permanently delete ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const result = await adminDeleteIndividual(row.gedcom_id);
          if (!result.success) {
            Alert.alert('Error', result.error ?? 'Delete failed');
            return;
          }
          setResults((prev) => prev.filter((r) => r.gedcom_id !== row.gedcom_id));
          void refreshFromCloud();
          void loadCloudCounts();
        },
      },
    ]);
  };

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Data Console' }} />
        <Text style={styles.denied}>Admin access required</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Data Console', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.text, headerShadowVisible: false }} />

      <View style={styles.syncBanner}>
        <Database size={16} color={Colors.accent} />
        <Text style={styles.syncText}>
          Local: {individualCount.toLocaleString()} people · {familyCount.toLocaleString()} families
        </Text>
        {cloudCounts && (
          <Text style={styles.syncTextSecondary}>
            Cloud: {cloudCounts.individuals.toLocaleString()} · {cloudCounts.families.toLocaleString()}
          </Text>
        )}
        <TouchableOpacity onPress={() => void refreshFromCloud()}>
          <Text style={styles.syncRefresh}>Sync</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <Search size={18} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or ID..."
          placeholderTextColor={Colors.textLight}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void handleSearch()}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchBtn} onPress={() => void handleSearch()} disabled={searching}>
          {searching ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.searchBtnText}>Go</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {results.length === 0 && !searching ? (
          <Text style={styles.hint}>Search the database directly by name or gedcom ID.</Text>
        ) : null}
        {results.map((row) => {
          const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.gedcom_id;
          return (
            <View key={row.gedcom_id} style={styles.resultCard}>
              <TouchableOpacity style={styles.resultMain} onPress={() => openEdit(row)}>
                <Text style={styles.resultName}>{name}</Text>
                <Text style={styles.resultId}>{row.gedcom_id}</Text>
                {row.birth_date ? <Text style={styles.resultMeta}>b. {row.birth_date}</Text> : null}
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteIcon} onPress={() => handleDelete(row)}>
                <Trash2 size={18} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={styles.modal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Text style={styles.modalTitle}>Edit {selected?.gedcom_id}</Text>
          {(['first_name', 'last_name', 'gender', 'birth_date', 'birth_place', 'death_date', 'death_place', 'notes'] as const).map((field) => (
            <View key={field} style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{field.replace(/_/g, ' ')}</Text>
              <TextInput
                style={[styles.fieldInput, field === 'notes' && styles.fieldInputMultiline]}
                value={editFields[field] ?? ''}
                onChangeText={(v) => setEditFields((f) => ({ ...f, [field]: v }))}
                multiline={field === 'notes'}
              />
            </View>
          ))}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setSelected(null)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSave} onPress={() => void handleSave()} disabled={saving}>
              {saving ? <ActivityIndicator color={Colors.white} /> : (
                <>
                  <Save size={16} color={Colors.white} />
                  <Text style={styles.modalSaveText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  denied: { textAlign: 'center', marginTop: 40, color: Colors.textSecondary },
  syncBanner: { margin: 16, padding: 12, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, gap: 4 },
  syncText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  syncTextSecondary: { fontSize: 12, color: Colors.textSecondary },
  syncRefresh: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const, marginTop: 4 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, gap: 8 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 12 },
  searchBtn: { backgroundColor: Colors.accent, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  searchBtnText: { color: Colors.white, fontWeight: '600' as const },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },
  hint: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 24 },
  resultCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 8, overflow: 'hidden' },
  resultMain: { flex: 1, padding: 14 },
  resultName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  resultId: { fontSize: 11, color: Colors.textLight, marginTop: 2 },
  resultMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  deleteIcon: { padding: 14 },
  modal: { flex: 1, padding: 20, backgroundColor: Colors.background },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginBottom: 16 },
  fieldGroup: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 4, textTransform: 'capitalize' as const },
  fieldInput: { borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 8, padding: 10, fontSize: 15, color: Colors.text, backgroundColor: Colors.card },
  fieldInputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancel: { flex: 1, padding: 14, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: Colors.cardBorder },
  modalCancelText: { color: Colors.textSecondary, fontWeight: '600' as const },
  modalSave: { flex: 1, flexDirection: 'row', gap: 8, padding: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: Colors.success },
  modalSaveText: { color: Colors.white, fontWeight: '600' as const },
});
