import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Keyboard,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, TreePine, Upload, X, Users, AlertCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { useProfile } from '@/contexts/ProfileContext';
import { useSearchHistory } from '@/contexts/SearchHistoryContext';
import { useAuth } from '@/contexts/AuthContext';
import { GedcomIndividual } from '@/types/genealogy';
import { calculateRelationship } from '@/utils/relationship';
import PersonCard from '@/components/PersonCard';
import AuthGate from '@/components/AuthGate';

export default function SearchScreen() {
  const { isSignedIn, isEnabled } = useAuth();

  if (!isSignedIn || !isEnabled) {
    return <AuthGate><View /></AuthGate>;
  }

  return <SearchScreenContent />;
}

function SearchScreenContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hasData, search, individualCount, familyCount, isReady, treeData, isBackgroundSyncing, isLoadingFromCloud, loadProgress, cloudError } = useFamilyTree();
  const { profile, hasClaimed } = useProfile();
  const { addEntry } = useSearchHistory();
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<GedcomIndividual[]>([]);
  const [hasSearched, setHasSearched] = useState<boolean>(false);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const inputRef = useRef<TextInput>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLoading = !isReady && !hasData;
  const canSearch = hasData;

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
      if (text.trim().length >= 2 && canSearch) {
        searchTimerRef.current = setTimeout(() => {
          try {
            const found = search(text);

            setResults(found);
            setHasSearched(true);
          } catch {
            setResults([]);
            setHasSearched(true);
          }
        }, 250);
      } else {
        searchTimerRef.current = null;
        setResults([]);
        if (text.trim().length === 0) {
          setHasSearched(false);
        }
      }
    },
    [search, canSearch]
  );

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const handleClear = useCallback(() => {

    setQuery('');
    setResults([]);
    setHasSearched(false);
    Keyboard.dismiss();
    inputRef.current?.blur();
    setIsFocused(false);
  }, []);

  const handlePersonPress = useCallback(
    (person: GedcomIndividual) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      addEntry({
        type: 'search',
        query: query,
        resultCount: results.length,
        selectedPersonId: person.id,
        selectedPersonName: person.name,
      });
      router.push(`/person/${person.id}`);
    },
    [query, results.length, addEntry, router]
  );

  const handleImport = useCallback(() => {
    router.push('/import-data');
  }, [router]);

  const [relationshipMap, setRelationshipMap] = useState<Map<string, string>>(new Map());
  const relationshipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relationshipBatchRef = useRef<number>(0);

  useEffect(() => {
    if (relationshipTimerRef.current) {
      clearTimeout(relationshipTimerRef.current);
    }

    if (!hasClaimed || !profile?.rootPersonId || !treeData || results.length === 0) {
      setRelationshipMap(new Map());
      return;
    }

    const myId = profile.rootPersonId;
    const currentResults = results;
    const batchId = ++relationshipBatchRef.current;

    relationshipTimerRef.current = setTimeout(() => {
      const map = new Map<string, string>();
      const batch = currentResults.slice(0, 10);
      for (const person of batch) {
        if (batchId !== relationshipBatchRef.current) return;
        if (person.id === myId) {
          map.set(person.id, 'You');
          continue;
        }
        try {
          const rel = calculateRelationship(myId, person.id, treeData);
          if (rel && rel.relationship && rel.relationship !== 'No blood relation found') {
            map.set(person.id, `Your ${rel.relationship}`);
          }
        } catch {
        }
      }
      if (batchId === relationshipBatchRef.current) {

        setRelationshipMap(map);
      }
    }, 600);

    return () => {
      if (relationshipTimerRef.current) {
        clearTimeout(relationshipTimerRef.current);
      }
    };
  }, [hasClaimed, profile?.rootPersonId, treeData, results]);

  const renderItem = useCallback(({ item }: { item: GedcomIndividual }) => {
    const relSubtitle = relationshipMap.get(item.id);
    return <PersonCard person={item} onPress={handlePersonPress} subtitle={relSubtitle} />;
  }, [handlePersonPress, relationshipMap]);

  const keyExtractor = useCallback((item: GedcomIndividual) => item.id, []);

  const renderBody = () => {
    if (isLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.centerMsg}>
            Initializing...
          </Text>
        </View>
      );
    }

    if (!hasData) {
      return (
        <View style={styles.center}>
          <View style={styles.iconCircle}>
            <TreePine size={36} color={Colors.accent} />
          </View>
          <Text style={styles.bigTitle}>No Family Tree Loaded</Text>
          <Text style={styles.desc}>Import a GEDCOM file to start searching your ancestors.</Text>
          <TouchableOpacity style={styles.actionBtn} onPress={handleImport} activeOpacity={0.7}>
            <Upload size={16} color="#fff" />
            <Text style={styles.actionBtnText}>Import GEDCOM File</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (hasSearched && results.length === 0) {
      return (
        <View style={styles.center}>
          <Search size={32} color={Colors.textLight} />
          <Text style={styles.bigTitle}>No Results</Text>
          <Text style={styles.desc}>No one found matching "{query}". Try a different name.</Text>
        </View>
      );
    }

    if (hasSearched && results.length > 0) {
      return (
        <FlatList
          data={results}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={styles.resultCount}>
              {results.length} result{results.length !== 1 ? 's' : ''}
            </Text>
          }
        />
      );
    }

    return (
      <View style={styles.center}>
        <View style={styles.iconCircleSm}>
          <Search size={28} color={Colors.accent} />
        </View>
        <Text style={styles.bigTitle}>Find an Ancestor</Text>
        <Text style={styles.desc}>Tap the search bar above to search by first or last name.</Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.pageTitle}>Search</Text>

      <View style={styles.searchSection}>
        <View style={[styles.searchBarOuter, isFocused && styles.searchBarOuterFocused]}>
          <Search size={20} color={isFocused ? Colors.accent : Colors.textLight} />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder={canSearch ? "Search by name..." : isLoading ? "Loading data..." : "Import data to search..."}
            placeholderTextColor={Colors.textLight}
            value={query}
            onChangeText={handleSearch}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            returnKeyType="search"
            autoCorrect={false}
            autoFocus={false}
            blurOnSubmit={true}
            editable={canSearch}
            testID="search-input"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={handleClear}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              testID="search-clear"
              activeOpacity={0.6}
            >
              <View style={styles.clearBtn}>
                <X size={14} color="#fff" />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {hasData && (
          <View style={styles.infoRow}>
            <View style={styles.chip}>
              <Users size={12} color={Colors.accent} />
              <Text style={styles.chipBold}>{individualCount.toLocaleString()}</Text>
              <Text style={styles.chipLabel}>People</Text>
            </View>
            <View style={styles.chip}>
              <TreePine size={12} color={Colors.accent} />
              <Text style={styles.chipBold}>{familyCount.toLocaleString()}</Text>
              <Text style={styles.chipLabel}>Families</Text>
            </View>
            <View style={styles.spacer} />
            {isBackgroundSyncing ? (
              <View style={styles.syncIndicator}>
                <ActivityIndicator size="small" color={Colors.accent} />
                <Text style={styles.syncText}>Syncing...</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.miniBtn} onPress={handleImport} activeOpacity={0.7}>
                <Upload size={13} color={Colors.accent} />
                <Text style={styles.miniBtnText}>Load Other</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {isLoadingFromCloud && !hasData && loadProgress && (
          <View style={styles.loadProgressRow}>
            <ActivityIndicator size="small" color={Colors.accent} />
            <Text style={styles.loadProgressText}>
              Loading: {loadProgress.individualsLoaded.toLocaleString()} people{loadProgress.individualsExpected ? ` / ${loadProgress.individualsExpected.toLocaleString()}` : ''}...
            </Text>
          </View>
        )}

        {cloudError && !hasData && (
          <View style={styles.errorRow}>
            <AlertCircle size={14} color={Colors.danger} />
            <Text style={styles.errorText} numberOfLines={2}>Load error. Pull down or tap Import to retry.</Text>
          </View>
        )}

        {!hasData && !isLoading && (
          <View style={styles.infoRow}>
            <AlertCircle size={14} color={Colors.danger} />
            <Text style={styles.warningText}>No family data loaded</Text>
            <View style={styles.spacer} />
            <TouchableOpacity style={styles.miniBtn} onPress={handleImport} activeOpacity={0.7}>
              <Upload size={13} color={Colors.accent} />
              <Text style={styles.miniBtnText}>Import</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {renderBody()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '800' as const,
    color: Colors.text,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  searchBarOuter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 2,
    borderColor: Colors.cardBorder,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: {
        elevation: 3,
      },
      default: {},
    }),
  },
  searchBarOuterFocused: {
    borderColor: Colors.accent,
    ...Platform.select({
      ios: {
        shadowColor: Colors.accent,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
      },
      default: {},
    }),
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    color: Colors.text,
    marginLeft: 10,
    paddingVertical: 0,
    height: 48,
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
      default: {},
    }),
  },
  clearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.textLight,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  infoRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 12,
    gap: 8,
  },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  chipBold: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  chipLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  warningText: {
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '500' as const,
  },
  spacer: {
    flex: 1,
  },
  miniBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: Colors.overlay,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  miniBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
  center: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  centerMsg: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
    marginTop: 12,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.overlay,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 20,
  },
  iconCircleSm: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.overlay,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 16,
  },
  bigTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  desc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 24,
  },
  actionBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#fff',
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 20,
  },
  resultCount: {
    fontSize: 13,
    color: Colors.textSecondary,
    paddingHorizontal: 20,
    paddingBottom: 10,
    fontWeight: '500' as const,
  },
  syncIndicator: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  syncText: {
    fontSize: 12,
    color: Colors.accent,
    fontWeight: '500' as const,
  },
  loadProgressRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 10,
    gap: 8,
  },
  loadProgressText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  errorRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 10,
    gap: 6,
  },
  errorText: {
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '500' as const,
    flex: 1,
  },
});
