import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Stack } from 'expo-router';
import { Upload, FileText, Check, AlertCircle } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { extractGedcomNotes, parseGedcom } from '@/utils/gedcom-parser';
import { backfillNotesToSupabase, importGedcomToSupabase } from '@/lib/supabase-db';

type ImportMode = 'notes' | 'full';

export default function AdminImportScreen() {
  const { isAdmin } = useAuth();
  const { refreshFromCloud } = useFamilyTree();
  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string } | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('notes');
  const [status, setStatus] = useState<'idle' | 'importing' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState<string>('');
  const [resultSummary, setResultSummary] = useState<string>('');

  const handlePickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const fileName = asset.name || 'file.ged';
    if (!fileName.toLowerCase().endsWith('.ged') && !fileName.toLowerCase().endsWith('.gedcom')) {
      Alert.alert('Invalid File', 'Please select a GEDCOM file (.ged or .gedcom).');
      return;
    }
    setSelectedFile({ name: fileName, uri: asset.uri });
    setStatus('idle');
    setResultSummary('');
  }, []);

  const readFileContent = useCallback(async (uri: string): Promise<string> => {
    if (Platform.OS === 'web') {
      const response = await fetch(uri);
      return response.text();
    }
    return new File(uri).text();
  }, []);

  const handleImport = useCallback(async () => {
    if (!selectedFile) return;
    setStatus('importing');
    setProgress('Reading GEDCOM file...');
    try {
      const content = await readFileContent(selectedFile.uri);

      if (importMode === 'notes') {
        setProgress('Extracting notes...');
        await new Promise((resolve) => setTimeout(resolve, 0));
        const notesByPersonId = extractGedcomNotes(content);
        setProgress(`Found notes for ${notesByPersonId.size} people. Updating database...`);

        const upload = await backfillNotesToSupabase(notesByPersonId, setProgress);
        if (!upload.success) {
          setStatus('error');
          setResultSummary(upload.error ?? 'Notes backfill failed');
          return;
        }

        setStatus('success');
        setResultSummary(`Updated notes for ${upload.updated} people.`);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await refreshFromCloud();
        return;
      }

      setProgress('Parsing full GEDCOM (this can take a while on large files)...');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const parsed = parseGedcom(content);
      const notesCount = Array.from(parsed.individuals.values()).filter((person) => person.note?.trim()).length;
      setProgress(`Parsed ${parsed.individuals.size} people (${notesCount} with notes). Uploading...`);

      const upload = await importGedcomToSupabase(parsed, setProgress);
      if (!upload.success) {
        setStatus('error');
        setResultSummary(upload.error ?? 'Import failed');
        return;
      }

      setStatus('success');
      setResultSummary(`Imported ${upload.imported} people (${notesCount} with notes).`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshFromCloud();
    } catch (e) {
      setStatus('error');
      setResultSummary(String(e));
    }
  }, [selectedFile, readFileContent, refreshFromCloud, importMode]);

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Admin Import' }} />
        <Text style={styles.msg}>Admin access required.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Import to Database' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.desc}>
          For large databases, use Notes Only to backfill person notes quickly. Full Import parses and upserts everyone and families, which takes much longer.
        </Text>

        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, importMode === 'notes' && styles.modeBtnActive]}
            onPress={() => setImportMode('notes')}
            activeOpacity={0.8}
          >
            <Text style={[styles.modeBtnText, importMode === 'notes' && styles.modeBtnTextActive]}>Notes Only</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, importMode === 'full' && styles.modeBtnActive]}
            onPress={() => setImportMode('full')}
            activeOpacity={0.8}
          >
            <Text style={[styles.modeBtnText, importMode === 'full' && styles.modeBtnTextActive]}>Full Import</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.pickBtn} onPress={handlePickFile}>
          <FileText size={18} color={Colors.accent} />
          <Text style={styles.pickBtnText}>{selectedFile ? selectedFile.name : 'Choose GEDCOM File'}</Text>
        </TouchableOpacity>

        {status === 'importing' && (
          <View style={styles.progressRow}>
            <ActivityIndicator color={Colors.accent} />
            <Text style={styles.progressText}>{progress}</Text>
          </View>
        )}

        {resultSummary ? (
          <View style={[styles.resultBox, status === 'error' && styles.resultError]}>
            {status === 'success' ? <Check size={16} color={Colors.success} /> : <AlertCircle size={16} color={Colors.danger} />}
            <Text style={styles.resultText}>{resultSummary}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.importBtn, (!selectedFile || status === 'importing') && { opacity: 0.5 }]}
          disabled={!selectedFile || status === 'importing'}
          onPress={handleImport}
        >
          <Upload size={18} color={Colors.white} />
          <Text style={styles.importBtnText}>
            {importMode === 'notes' ? 'Backfill Notes' : 'Full Import to Supabase'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, gap: 16 },
  msg: { textAlign: 'center', marginTop: 40, color: Colors.textSecondary },
  desc: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  modeBtnActive: {
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
    borderColor: Colors.accent,
  },
  modeBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.textSecondary },
  modeBtnTextActive: { color: Colors.accent },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  pickBtnText: { fontSize: 15, color: Colors.text, flex: 1 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  resultBox: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: Colors.card,
    padding: 12,
    borderRadius: 10,
  },
  resultError: { borderColor: Colors.danger, borderWidth: 1 },
  resultText: { flex: 1, fontSize: 13, color: Colors.text },
  importBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
  },
  importBtnText: { color: Colors.white, fontWeight: '600' as const, fontSize: 15 },
});
