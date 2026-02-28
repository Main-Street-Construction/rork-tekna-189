import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { FileText, Check, AlertCircle, FolderOpen, Upload } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';

export default function ImportDataScreen() {
  const router = useRouter();
  const { importGedcom, isImporting, hasData } = useFamilyTree();
  const [selectedFile, setSelectedFile] = useState<{ name: string; uri: string; size?: number } | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const triggerShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.95, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const handlePickFile = useCallback(async () => {
    try {
      console.log('[Import] Opening document picker...');
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      console.log('[Import] Picker result:', JSON.stringify(result, null, 2));

      if (result.canceled) {
        console.log('[Import] User cancelled picker');
        return;
      }

      const asset = result.assets[0];
      if (!asset) return;

      const fileName = asset.name || 'Unknown file';
      const isGedcom = fileName.toLowerCase().endsWith('.ged') || fileName.toLowerCase().endsWith('.gedcom');

      if (!isGedcom) {
        setStatus('error');
        setErrorMsg('Please select a GEDCOM file (.ged or .gedcom). Other file types are not supported.');
        triggerShake();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      setSelectedFile({
        name: fileName,
        uri: asset.uri,
        size: asset.size,
      });
      setStatus('idle');
      setErrorMsg('');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      console.log('[Import] File selected:', fileName, 'Size:', asset.size);
    } catch (e) {
      console.error('[Import] Picker error:', e);
      setStatus('error');
      setErrorMsg('Failed to open file picker. Please try again.');
    }
  }, [triggerShake]);

  const readFileContent = useCallback(async (uri: string): Promise<string> => {
    if (Platform.OS === 'web') {
      console.log('[Import] Reading file on web via fetch...');
      const response = await fetch(uri);
      const text = await response.text();
      return text;
    }

    try {
      console.log('[Import] Reading file on native via expo-file-system File class...');
      const file = new File(uri);
      console.log('[Import] File exists:', file.exists, 'size:', file.size);
      const content = await file.text();
      return content;
    } catch (fileError) {
      console.warn('[Import] File class failed, trying legacy readAsStringAsync...', fileError);
      const FileSystemLegacy = await import('expo-file-system/legacy');
      const content = await FileSystemLegacy.readAsStringAsync(uri);
      return content;
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!selectedFile) {
      setStatus('error');
      setErrorMsg('Please select a GEDCOM file first.');
      triggerShake();
      return;
    }

    setStatus('loading');
    startPulse();

    try {
      console.log('[Import] Reading file content from:', selectedFile.uri);
      const content = await readFileContent(selectedFile.uri);
      console.log('[Import] File content length:', content.length);

      if (!content.includes('INDI') && !content.includes('HEAD')) {
        setStatus('error');
        setErrorMsg(
          'This doesn\'t appear to be valid GEDCOM data. GEDCOM files typically start with "0 HEAD" and contain INDI records.'
        );
        pulseAnim.stopAnimation();
        pulseAnim.setValue(1);
        return;
      }

      await importGedcom(content);
      setStatus('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
      console.log('[Import] Import successful');
      setTimeout(() => {
        router.back();
      }, 1200);
    } catch (e) {
      console.error('[Import] Error:', e);
      setStatus('error');
      setErrorMsg('Failed to read or parse the file. Please make sure it\'s a valid GEDCOM file.');
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [selectedFile, importGedcom, router, triggerShake, startPulse, readFileContent, pulseAnim]);

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Import Data',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false,
          presentation: 'modal',
        }}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <FileText size={28} color={Colors.accent} />
          </View>
          <Text style={styles.headerTitle}>Import GEDCOM</Text>
          <Text style={styles.headerDesc}>
            Select a GEDCOM (.ged) file from your device. This standard
            genealogy format contains your family tree data.
          </Text>
        </View>

        <Animated.View
          style={[
            styles.filePickerArea,
            { transform: [{ translateX: shakeAnim }] },
            selectedFile && styles.filePickerAreaSelected,
          ]}
        >
          <TouchableOpacity
            style={styles.filePickerTouchable}
            onPress={handlePickFile}
            activeOpacity={0.7}
            disabled={status === 'loading' || status === 'success'}
            testID="file-picker-button"
          >
            {selectedFile ? (
              <View style={styles.selectedFileInfo}>
                <View style={styles.fileIconContainer}>
                  <FileText size={32} color={Colors.accent} />
                </View>
                <View style={styles.fileDetails}>
                  <Text style={styles.fileName} numberOfLines={2}>
                    {selectedFile.name}
                  </Text>
                  {selectedFile.size ? (
                    <Text style={styles.fileSize}>
                      {formatFileSize(selectedFile.size)}
                    </Text>
                  ) : null}
                  <Text style={styles.tapToChange}>Tap to choose a different file</Text>
                </View>
              </View>
            ) : (
              <View style={styles.emptyPicker}>
                <View style={styles.uploadIconCircle}>
                  <FolderOpen size={36} color={Colors.accent} />
                </View>
                <Text style={styles.pickFileTitle}>Choose GEDCOM File</Text>
                <Text style={styles.pickFileSubtitle}>
                  Tap to browse your files
                </Text>
                <View style={styles.supportedFormats}>
                  <Text style={styles.formatBadge}>.ged</Text>
                  <Text style={styles.formatBadge}>.gedcom</Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {status === 'error' && (
          <View style={styles.errorBanner}>
            <AlertCircle size={16} color={Colors.danger} />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {status === 'success' && (
          <View style={styles.successBanner}>
            <Check size={16} color={Colors.success} />
            <Text style={styles.successText}>
              Data imported successfully! Redirecting...
            </Text>
          </View>
        )}

        <Animated.View style={{ transform: [{ scale: status === 'loading' ? pulseAnim : 1 }] }}>
          <TouchableOpacity
            style={[
              styles.importButton,
              !selectedFile && styles.importButtonInactive,
              (status === 'loading' || status === 'success') && styles.importButtonDisabled,
            ]}
            onPress={handleImport}
            disabled={!selectedFile || status === 'loading' || status === 'success'}
            testID="import-button"
          >
            {status === 'loading' ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={Colors.white} />
                <Text style={styles.importButtonText}>Parsing file...</Text>
              </View>
            ) : (
              <>
                <Upload size={18} color={Colors.white} />
                <Text style={styles.importButtonText}>
                  {hasData ? 'Replace & Import' : 'Import Data'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        {hasData && (
          <Text style={styles.warningText}>
            Importing new data will replace your existing family tree.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  headerDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  filePickerArea: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.cardBorder,
    borderStyle: 'dashed',
    backgroundColor: Colors.card,
    overflow: 'hidden',
  },
  filePickerAreaSelected: {
    borderStyle: 'solid',
    borderColor: Colors.accent,
  },
  filePickerTouchable: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 180,
  },
  emptyPicker: {
    alignItems: 'center',
    gap: 10,
  },
  uploadIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  pickFileTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  pickFileSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  supportedFormats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  formatBadge: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.accent,
    backgroundColor: Colors.overlay,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  selectedFileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    width: '100%',
  },
  fileIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileDetails: {
    flex: 1,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  fileSize: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  tapToChange: {
    fontSize: 12,
    color: Colors.accent,
    fontWeight: '500' as const,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(196, 92, 74, 0.08)',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    gap: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.danger,
    lineHeight: 18,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(74, 124, 89, 0.08)',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    gap: 10,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    color: Colors.success,
    fontWeight: '500' as const,
  },
  importButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 52,
    marginTop: 20,
    gap: 8,
  },
  importButtonInactive: {
    opacity: 0.4,
  },
  importButtonDisabled: {
    opacity: 0.6,
  },
  importButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  warningText: {
    fontSize: 13,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },
});
