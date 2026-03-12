import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Animated,
  Keyboard,
  ActivityIndicator,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Search,
  X,
  GitFork,
  ArrowRight,
  TreePine,
  Upload,
  ChevronDown,
  ChevronUp,
  Heart,
  User,
  Share2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import Colors from '@/constants/colors';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { useProfile } from '@/contexts/ProfileContext';
import { useSearchHistory } from '@/contexts/SearchHistoryContext';
import { useAuth } from '@/contexts/AuthContext';
import { GedcomIndividual, FamilyTreeData } from '@/types/genealogy';
import {
  calculateAllRelationships,
  MultiRelationshipResult,
  MultiRelationshipEntry,
} from '@/utils/relationship';
import PersonCard from '@/components/PersonCard';
import RelationshipPathView from '@/components/RelationshipPathView';
import AuthGate from '@/components/AuthGate';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function RelationshipScreen() {
  const { isSignedIn, isEnabled } = useAuth();

  if (!isSignedIn || !isEnabled) {
    return <AuthGate><View /></AuthGate>;
  }

  return <RelationshipScreenContent />;
}

function RelationshipScreenContent() {
  const router = useRouter();
  const { hasData, search, treeData, isReady, getPerson } = useFamilyTree();
  const { profile, hasClaimed } = useProfile();
  const { addRelationshipEntry } = useSearchHistory();
  const [person1, setPerson1] = useState<GedcomIndividual | null>(null);
  const [person2, setPerson2] = useState<GedcomIndividual | null>(null);
  const [selectingSlot, setSelectingSlot] = useState<1 | 2>(1);
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<GedcomIndividual[]>([]);
  const [multiResult, setMultiResult] =
    useState<MultiRelationshipResult | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [showResult, setShowResult] = useState<boolean>(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const handleSearch = useCallback(
    (text: string) => {
      setQuery(text);
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
      if (text.trim().length >= 2 && hasData) {
        searchTimerRef.current = setTimeout(() => {
          try {
            const found = search(text);
            console.log('[RelationshipScreen] Search for', text, 'found', found.length, 'results');
            setResults(found.slice(0, 50));
          } catch (e) {
            console.error('[RelationshipScreen] Search error:', e);
            setResults([]);
          }
        }, 250);
      } else {
        searchTimerRef.current = null;
        setResults([]);
      }
    },
    [search, hasData]
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleClearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    Keyboard.dismiss();
  }, []);

  const animateTransition = useCallback(
    (callback: () => void) => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        callback();
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      });
    },
    [fadeAnim]
  );

  const handleSelectPerson = useCallback(
    (person: GedcomIndividual) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Keyboard.dismiss();

      if (selectingSlot === 1) {
        animateTransition(() => {
          setPerson1(person);
          setSelectingSlot(2);
          setQuery('');
          setResults([]);
        });
        return;
      }

      const p1 = person1;
      const p2 = person;
      const td = treeData;

      setPerson2(person);
      setQuery('');
      setResults([]);
      setShowResult(true);
      setIsCalculating(true);
      setExpandedIndex(null);

      if (td && p1) {
        const p1Id = p1.id;
        const p2Id = p2.id;
        console.log('[RelationshipScreen] Will calculate relationship between', p1Id, '(', p1.name, ') and', p2Id, '(', p2.name, ')');
        setTimeout(() => {
          try {
            console.log('[RelationshipScreen] Starting multi-calculation...');
            const result = calculateAllRelationships(p1Id, p2Id, td);

            setMultiResult(result);
            setIsCalculating(false);
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success
            );
            if (result) {
              addRelationshipEntry({
                person1Id: p1Id,
                person1Name: p1.name,
                person2Id: p2Id,
                person2Name: p2.name,
                relationshipResult: result.closestRelationship,
                pathCount: result.entries.length,
              });
            }
          } catch (e) {
            console.error('[RelationshipScreen] Calculation error:', e);
            setMultiResult(null);
            setIsCalculating(false);
          }
        }, 300);
      } else {
        console.error('[RelationshipScreen] Missing data for calculation - treeData:', !!td, 'person1:', !!p1);
        setIsCalculating(false);
      }
    },
    [treeData, person1, selectingSlot, addRelationshipEntry, animateTransition]
  );

  const handleAutofillMe = useCallback(() => {
    if (!hasClaimed || !profile?.rootPersonId) {
      console.log('[RelationshipScreen] Autofill failed - hasClaimed:', hasClaimed, 'rootPersonId:', profile?.rootPersonId);
      return;
    }
    const claimedPerson = getPerson(profile.rootPersonId);
    console.log('[RelationshipScreen] Autofill - looking up rootPersonId:', profile.rootPersonId, 'found:', !!claimedPerson);
    if (!claimedPerson) {
      Alert.alert(
        'Identity Not Found',
        'Your claimed identity could not be found in the current tree data. You may need to re-claim your identity in the Profile tab.',
        [{ text: 'OK' }]
      );
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (selectingSlot === 1) {
      animateTransition(() => {
        setPerson1(claimedPerson);
        setSelectingSlot(2);
        setQuery('');
        setResults([]);
      });
    } else {
      const p1 = person1;
      const td = treeData;

      setPerson2(claimedPerson);
      setQuery('');
      setResults([]);
      setShowResult(true);
      setIsCalculating(true);
      setExpandedIndex(null);

      if (td && p1) {
        const p1Id = p1.id;
        const p2Id = claimedPerson.id;
        setTimeout(() => {
          try {
            console.log('[RelationshipScreen] Starting multi-calculation (autofill)...');
            const result = calculateAllRelationships(p1Id, p2Id, td);

            setMultiResult(result);
            setIsCalculating(false);
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success
            );
            if (result) {
              addRelationshipEntry({
                person1Id: p1Id,
                person1Name: p1.name,
                person2Id: p2Id,
                person2Name: claimedPerson.name,
                relationshipResult: result.closestRelationship,
                pathCount: result.entries.length,
              });
            }
          } catch (e) {
            console.error('[RelationshipScreen] Autofill calculation error:', e);
            setMultiResult(null);
            setIsCalculating(false);
          }
        }, 300);
      } else {
        console.error('[RelationshipScreen] Missing data for autofill calculation');
        setIsCalculating(false);
      }
    }
  }, [hasClaimed, profile?.rootPersonId, getPerson, selectingSlot, treeData, person1, addRelationshipEntry, animateTransition]);

  const handleReset = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTransition(() => {
      setPerson1(null);
      setPerson2(null);
      setMultiResult(null);
      setShowResult(false);
      setQuery('');
      setResults([]);
      setIsCalculating(false);
      setExpandedIndex(null);
      setSelectingSlot(1);
    });
  }, [animateTransition]);

  const _handleSwapAndRecalculate = useCallback(() => {
    if (!person1 || !person2 || !treeData) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const oldP1 = person1;
    const oldP2 = person2;
    setPerson1(oldP2);
    setPerson2(oldP1);
    setIsCalculating(true);
    setExpandedIndex(null);
    setTimeout(() => {
      try {
        const result = calculateAllRelationships(oldP2.id, oldP1.id, treeData);
        setMultiResult(result);
        setIsCalculating(false);
        if (result) {
          addRelationshipEntry({
            person1Id: oldP2.id,
            person1Name: oldP2.name,
            person2Id: oldP1.id,
            person2Name: oldP1.name,
            relationshipResult: result.closestRelationship,
            pathCount: result.entries.length,
          });
        }
      } catch (e) {
        console.error('[RelationshipScreen] Swap calculation error:', e);
        setMultiResult(null);
        setIsCalculating(false);
      }
    }, 300);
  }, [person1, person2, treeData, addRelationshipEntry]);

  const handlePersonPress = useCallback(
    (person: GedcomIndividual) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push(`/person/${person.id}`);
    },
    [router]
  );

  const handleImport = useCallback(() => {
    router.push('/import-data');
  }, [router]);

  const handleToggleExpand = useCallback((index: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS !== 'web') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  const handleChangePerson1 = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateTransition(() => {
      setPerson1(null);
      setSelectingSlot(1);
      setQuery('');
      setResults([]);
    });
  }, [animateTransition]);

  const isLoading = !isReady;

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={{ color: Colors.textSecondary, marginTop: 12, fontSize: 14 }}>Loading family data...</Text>
      </View>
    );
  }

  if (!hasData) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconWrap}>
            <TreePine size={32} color={Colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>No Family Data</Text>
          <Text style={styles.emptyDesc}>
            Import a GEDCOM file to start calculating relationships between
            individuals.
          </Text>
          <TouchableOpacity style={styles.emptyButton} onPress={handleImport}>
            <Upload size={16} color={Colors.white} />
            <Text style={styles.emptyButtonText}>Import GEDCOM File</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (showResult) {
    return (
      <View style={styles.container}>
        <Animated.View style={[styles.resultContainer, { opacity: fadeAnim }]}>
          <ScrollView
            contentContainerStyle={styles.resultScroll}
            showsVerticalScrollIndicator={false}
          >
            {isCalculating ? (
              <View style={styles.calculatingContainer}>
                <ActivityIndicator size="large" color={Colors.accent} />
                <Text style={styles.calculatingText}>
                  Finding all relationship paths...
                </Text>
              </View>
            ) : multiResult ? (
              <>
                <View style={styles.resultHeader}>
                  <View style={styles.resultPersonRow}>
                    <TouchableOpacity
                      style={styles.resultPersonPill}
                      onPress={() =>
                        person1 && handlePersonPress(person1)
                      }
                    >
                      <View
                        style={[
                          styles.resultPersonDot,
                          {
                            backgroundColor:
                              person1?.sex === 'F'
                                ? Colors.female
                                : Colors.male,
                          },
                        ]}
                      />
                      <Text style={styles.resultPersonName} numberOfLines={1}>
                        {person1?.givenName ?? ''}
                      </Text>
                    </TouchableOpacity>

                    <ArrowRight size={16} color={Colors.textLight} />

                    <TouchableOpacity
                      style={styles.resultPersonPill}
                      onPress={() =>
                        person2 && handlePersonPress(person2)
                      }
                    >
                      <View
                        style={[
                          styles.resultPersonDot,
                          {
                            backgroundColor:
                              person2?.sex === 'F'
                                ? Colors.female
                                : Colors.male,
                          },
                        ]}
                      />
                      <Text style={styles.resultPersonName} numberOfLines={1}>
                        {person2?.givenName ?? ''}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.relationshipBadge}>
                    <GitFork size={18} color={Colors.white} />
                    <Text style={styles.relationshipText}>
                      {multiResult.closestRelationship}
                    </Text>
                  </View>

                  {multiResult.closestRelationship !==
                    multiResult.closestReverseRelationship && (
                    <Text style={styles.reverseText}>
                      {person1?.givenName} is {person2?.givenName}&apos;s{' '}
                      {multiResult.closestReverseRelationship}
                    </Text>
                  )}

                  {multiResult.isSpouse && (
                    <View style={styles.spouseBadge}>
                      <Heart size={14} color={Colors.female} />
                      <Text style={styles.spouseBadgeText}>Also Spouse</Text>
                    </View>
                  )}
                </View>

                {multiResult.entries.length > 0 && (
                  <View style={styles.pathsList}>
                    <View style={styles.pathsListHeader}>
                      <Text style={styles.pathsListTitle}>
                        All Relationship Paths
                      </Text>
                      <View style={styles.pathsCountBadge}>
                        <Text style={styles.pathsCountText}>
                          {multiResult.entries.length}
                        </Text>
                      </View>
                    </View>

                    {multiResult.entries.map((entry, index) => (
                      <RelationshipEntryCard
                        key={`${entry.commonAncestor.ancestorId}-${index}`}
                        entry={entry}
                        index={index}
                        isExpanded={expandedIndex === index}
                        onToggle={handleToggleExpand}
                        person1={multiResult.person1}
                        person2={multiResult.person2}
                        treeData={treeData!}
                        onPersonPress={handlePersonPress}
                        isClosest={index === 0}
                      />
                    ))}
                  </View>
                )}

                {multiResult.entries.length === 0 && !multiResult.isSpouse && (
                  <View style={styles.noAncestorNote}>
                    <Text style={styles.noAncestorText}>
                      No connection found between these two individuals in
                      the available family data.
                    </Text>
                  </View>
                )}

                {multiResult.entries.length === 0 && multiResult.isSpouse && (
                  <View style={styles.noAncestorNote}>
                    <Text style={styles.noAncestorText}>
                      These two are connected through marriage but share no
                      common blood ancestor in the available data.
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.noAncestorNote}>
                <Text style={styles.noAncestorText}>
                  Could not calculate relationship.
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.resultActions}>
            <TouchableOpacity
              style={styles.resetButton}
              onPress={handleReset}
            >
              <Text style={styles.resetButtonText}>New Calculation</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.searchWrapper, { opacity: fadeAnim }]}>
        {person1 && selectingSlot === 2 && (
          <TouchableOpacity style={styles.selectedBanner} onPress={handleChangePerson1} activeOpacity={0.7}>
            <View style={styles.selectedBannerLeft}>
              <View
                style={[
                  styles.selectedDot,
                  {
                    backgroundColor:
                      person1.sex === 'F' ? Colors.female : Colors.male,
                  },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.selectedLabel}>Person 1</Text>
                <Text style={styles.selectedName} numberOfLines={1}>
                  {person1.name}
                </Text>
              </View>
            </View>
            <View style={styles.changePill}>
              <Text style={styles.changePillText}>Change</Text>
            </View>
          </TouchableOpacity>
        )}

        <View style={styles.stepHeader}>
          <Text style={styles.stepTitle}>
            {selectingSlot === 1 ? 'Select Person 1' : 'Select Person 2'}
          </Text>
          <Text style={styles.stepSubtitle}>
            {selectingSlot === 1
              ? 'Choose the first person to compare'
              : 'Now choose who to compare them with'}
          </Text>
        </View>

        {hasClaimed && (
          <TouchableOpacity style={styles.autofillMeButton} onPress={handleAutofillMe} activeOpacity={0.7}>
            <User size={16} color={Colors.white} />
            <Text style={styles.autofillMeText}>Use Me ({profile?.rootPersonName?.split(' ')[0]})</Text>
          </TouchableOpacity>
        )}

        <View style={styles.searchBar}>
          <Search size={18} color={Colors.textLight} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for a person..."
            placeholderTextColor={Colors.textLight}
            value={query}
            onChangeText={handleSearch}
            returnKeyType="search"
            autoCorrect={false}
            autoFocus={false}
            testID="relationship-search-input"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={handleClearSearch}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={styles.clearButton}>
                <X size={14} color={Colors.white} />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {results.length > 0 ? (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <PersonCard
                person={item}
                onPress={handleSelectPerson}
                compact
              />
            )}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <Text style={styles.resultCount}>
                {results.length} result{results.length !== 1 ? 's' : ''}
              </Text>
            }
          />
        ) : query.length >= 2 ? (
          <View style={styles.noResults}>
            <Text style={styles.noResultsText}>
              No matches for &quot;{query}&quot;
            </Text>
          </View>
        ) : (
          <View style={styles.hintContainer}>
            <GitFork size={28} color={Colors.accent} />
            <Text style={styles.hintTitle}>
              Relationship Calculator
            </Text>
            <Text style={styles.hintText}>
              Search for any two people to discover all relationship paths between them.
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

function generatePathHtml(
  person1: GedcomIndividual,
  person2: GedcomIndividual,
  entry: MultiRelationshipEntry,
  treeData: FamilyTreeData,
): string {
  const path1 = entry.commonAncestor.pathFromAncestorToPerson1;
  const path2 = entry.commonAncestor.pathFromAncestorToPerson2;

  const getPersonName = (id: string) => {
    const p = treeData.individuals.get(id);
    return p?.name ?? 'Unknown';
  };

  const getPersonDates = (id: string) => {
    const p = treeData.individuals.get(id);
    const parts: string[] = [];
    if (p?.birthDate) parts.push(`b. ${p.birthDate}`);
    if (p?.deathDate) parts.push(`d. ${p.deathDate}`);
    return parts.join(' - ');
  };

  const getGenderColor = (id: string) => {
    const p = treeData.individuals.get(id);
    if (p?.sex === 'F') return '#B06A8F';
    if (p?.sex === 'M') return '#5B7FA6';
    return '#7A7168';
  };

  const renderPathColumn = (path: string[], _label: string, _targetName: string) => {
    if (path.length <= 1) return `<div style="text-align:center;color:#7A7168;font-style:italic;padding:12px 0;">Same person</div>`;
    return path.slice(1).map((id) => {
      const name = getPersonName(id);
      const dates = getPersonDates(id);
      const color = getGenderColor(id);
      const isTarget = id === person1.id || id === person2.id;
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;margin:4px 0;background:${isTarget ? 'rgba(200,149,108,0.08)' : '#fff'};border-radius:10px;border:${isTarget ? '2px solid #C8956C' : '1px solid #E8DED4'};">
          <div style="width:28px;height:28px;border-radius:14px;background:${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="color:#fff;font-size:10px;font-weight:700;">${name.split(' ').map((n: string) => n[0] || '').slice(0, 2).join('')}</span>
          </div>
          <div>
            <div style="font-size:13px;font-weight:600;color:${isTarget ? '#C8956C' : '#2D2A26'};">${name}</div>
            ${dates ? `<div style="font-size:10px;color:#7A7168;">${dates}</div>` : ''}
          </div>
        </div>
        <div style="text-align:center;color:#E8DED4;font-size:16px;">&#9660;</div>
      `;
    }).join('');
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @page { margin: 24px; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F5F0EB; margin: 0; padding: 24px; }
    .card { background: #fff; border-radius: 16px; padding: 24px; border: 1px solid #E8DED4; }
    .header { text-align: center; margin-bottom: 20px; }
    .badge { display: inline-block; background: #2C3930; color: #fff; padding: 8px 20px; border-radius: 20px; font-size: 16px; font-weight: 700; }
    .persons { display: flex; justify-content: center; align-items: center; gap: 12px; margin-bottom: 16px; }
    .person-pill { background: #F5F0EB; padding: 8px 14px; border-radius: 16px; font-size: 13px; font-weight: 600; color: #2D2A26; }
    .ancestor-section { text-align: center; margin: 16px 0; }
    .ancestor-label { font-size: 10px; font-weight: 700; color: #4A7C59; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .ancestor-node { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 12px; border: 2px solid #4A7C59; background: rgba(74,124,89,0.05); }
    .branches { display: flex; gap: 16px; margin-top: 16px; }
    .branch { flex: 1; }
    .branch-label { font-size: 11px; font-weight: 600; color: #7A7168; margin-bottom: 8px; text-align: center; }
    .footer { text-align: center; margin-top: 16px; font-size: 10px; color: #A49A8E; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="persons">
        <span class="person-pill">${person1.name}</span>
        <span style="color:#A49A8E;">&#8594;</span>
        <span class="person-pill">${person2.name}</span>
      </div>
      <div class="badge">${entry.relationship}</div>
    </div>
    <div class="ancestor-section">
      <div class="ancestor-label">Common Ancestor</div>
      <div class="ancestor-node">
        <div style="width:28px;height:28px;border-radius:14px;background:#4A7C59;display:flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:12px;">&#9733;</span>
        </div>
        <div>
          <div style="font-size:14px;font-weight:700;color:#4A7C59;">${entry.commonAncestor.ancestor.name}</div>
          ${getPersonDates(entry.commonAncestor.ancestorId) ? `<div style="font-size:10px;color:#7A7168;">${getPersonDates(entry.commonAncestor.ancestorId)}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="branches">
      <div class="branch">
        <div class="branch-label">To ${person1.givenName}</div>
        ${renderPathColumn(path1, 'Path 1', person1.name)}
      </div>
      <div style="width:1px;background:#E8DED4;margin-top:28px;"></div>
      <div class="branch">
        <div class="branch-label">To ${person2.givenName}</div>
        ${renderPathColumn(path2, 'Path 2', person2.name)}
      </div>
    </div>
  </div>
  <div class="footer">Generated from Family Tree App</div>
</body>
</html>`;
}

interface RelationshipEntryCardProps {
  entry: MultiRelationshipEntry;
  index: number;
  isExpanded: boolean;
  onToggle: (index: number) => void;
  person1: GedcomIndividual;
  person2: GedcomIndividual;
  treeData: FamilyTreeData;
  onPersonPress: (person: GedcomIndividual) => void;
  isClosest: boolean;
}

const RelationshipEntryCard = React.memo(function RelationshipEntryCard({
  entry,
  index,
  isExpanded,
  onToggle,
  person1,
  person2,
  treeData,
  onPersonPress,
  isClosest,
}: RelationshipEntryCardProps) {
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const pathViewRef = useRef<View>(null);

  const handleShare = useCallback(async () => {
    try {
      setIsSharing(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (Platform.OS === 'web') {
        const html = generatePathHtml(person1, person2, entry, treeData);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${person1.givenName}-${person2.givenName}-relationship.html`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        if (!pathViewRef.current) {
          Alert.alert('Share Error', 'Please expand the path view first and try again.');
          return;
        }
        const uri = await captureRef(pathViewRef, {
          format: 'png',
          quality: 1,
          result: 'tmpfile',
        });
        console.log('[RelationshipScreen] Captured image at:', uri);
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: `${person1.givenName} & ${person2.givenName} - Relationship`,
          UTI: 'public.png',
        });
      }
    } catch (e) {
      console.error('[RelationshipScreen] Share error:', e);
      Alert.alert('Share Failed', 'Could not generate the relationship image. Please try again.');
    } finally {
      setIsSharing(false);
    }
  }, [person1, person2, entry, treeData]);

  return (
    <View style={[styles.entryCard, isClosest && styles.entryCardClosest]}>
      <TouchableOpacity
        style={styles.entryHeader}
        onPress={() => onToggle(index)}
        activeOpacity={0.7}
      >
        <View style={styles.entryLeft}>
          <View style={styles.entryRank}>
            <Text style={[styles.entryRankText, isClosest && styles.entryRankTextClosest]}>
              {index + 1}
            </Text>
          </View>
          <View style={styles.entryInfo}>
            <Text style={[styles.entryRelationship, isClosest && styles.entryRelationshipClosest]}>
              {entry.relationship}
            </Text>
            <Text style={styles.entryAncestorName} numberOfLines={1}>
              via {entry.commonAncestor.ancestor.name}
            </Text>
          </View>
        </View>
        <View style={styles.entryRight}>
          <View style={styles.entryGenBadge}>
            <Text style={styles.entryGenText}>
              {entry.totalGenerations}g
            </Text>
          </View>
          {isExpanded ? (
            <ChevronUp size={18} color={Colors.textSecondary} />
          ) : (
            <ChevronDown size={18} color={Colors.textSecondary} />
          )}
        </View>
      </TouchableOpacity>

      {isExpanded && treeData && (
        <View style={styles.entryPathContainer}>
          <View ref={pathViewRef} collapsable={false} style={styles.captureContainer}>
            <View style={styles.captureTopBar} />
            <View style={styles.captureHeader}>
              <View style={styles.capturePersonRow}>
                <View style={styles.capturePersonPill}>
                  <View style={[styles.capturePersonDot, { backgroundColor: person1.sex === 'F' ? Colors.female : Colors.male }]} />
                  <Text style={styles.capturePersonName} numberOfLines={1}>{person1.name}</Text>
                </View>
                <View style={styles.captureArrowWrap}>
                  <ArrowRight size={12} color="#A49A8E" />
                </View>
                <View style={styles.capturePersonPill}>
                  <View style={[styles.capturePersonDot, { backgroundColor: person2.sex === 'F' ? Colors.female : Colors.male }]} />
                  <Text style={styles.capturePersonName} numberOfLines={1}>{person2.name}</Text>
                </View>
              </View>
              <View style={styles.captureBadge}>
                <GitFork size={14} color="#fff" />
                <Text style={styles.captureBadgeText}>{entry.relationship}</Text>
              </View>
              {entry.relationship !== entry.reverseRelationship && (
                <Text style={styles.captureReverseLabel}>
                  {person1.givenName} is {person2.givenName}&apos;s {entry.reverseRelationship}
                </Text>
              )}
            </View>
            <RelationshipPathView
              person1={person1}
              person2={person2}
              commonAncestor={entry.commonAncestor}
              data={treeData}
              onPersonPress={onPersonPress}
              isCapture
            />
            <View style={styles.captureFooterRow}>
              <View style={styles.captureFooterLine} />
              <Text style={styles.captureFooter}>Family Tree</Text>
              <View style={styles.captureFooterLine} />
            </View>
          </View>
          <TouchableOpacity
            style={styles.sharePathButton}
            onPress={handleShare}
            activeOpacity={0.7}
            disabled={isSharing}
          >
            {isSharing ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Share2 size={14} color={Colors.white} />
            )}
            <Text style={styles.sharePathText}>
              {isSharing ? 'Generating...' : 'Share as Image'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyButton: {
    marginTop: 24,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyButtonText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600' as const,
  },
  autofillMeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  autofillMeText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  changePill: {
    backgroundColor: Colors.overlay,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  changePillText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
  searchWrapper: {
    flex: 1,
  },
  selectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.success,
  },
  selectedBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  selectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  selectedLabel: {
    fontSize: 11,
    color: Colors.success,
    fontWeight: '600' as const,
  },
  selectedName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  stepHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  stepSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.searchBar,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    marginLeft: 10,
    height: 48,
  },
  clearButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.textLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 20,
    paddingHorizontal: 16,
  },
  resultCount: {
    fontSize: 13,
    color: Colors.textSecondary,
    paddingBottom: 10,
    fontWeight: '500' as const,
  },
  noResults: {
    alignItems: 'center',
    paddingTop: 40,
  },
  noResultsText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  hintContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  hintTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  hintText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  resultContainer: {
    flex: 1,
  },
  resultScroll: {
    paddingTop: 8,
    paddingBottom: 100,
  },
  calculatingContainer: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 16,
  },
  calculatingText: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  resultHeader: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  resultPersonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  resultPersonPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 8,
    maxWidth: 150,
  },
  resultPersonDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  resultPersonName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  relationshipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 10,
  },
  relationshipText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.white,
  },
  reverseText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 12,
    fontStyle: 'italic' as const,
  },
  spouseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(176, 106, 143, 0.1)',
    gap: 6,
  },
  spouseBadgeText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.female,
  },
  pathsList: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pathsListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  pathsListTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  pathsCountBadge: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  pathsCountText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.white,
  },
  entryCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 10,
    overflow: 'hidden',
  },
  entryCardClosest: {
    borderColor: Colors.accent,
    borderWidth: 2,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  entryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  entryRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  entryRankText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
  },
  entryRankTextClosest: {
    color: Colors.accent,
  },
  entryInfo: {
    flex: 1,
  },
  entryRelationship: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  entryRelationshipClosest: {
    color: Colors.accent,
  },
  entryAncestorName: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  entryRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  entryGenBadge: {
    backgroundColor: Colors.backgroundDark,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  entryGenText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  entryPathContainer: {
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sharePathButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: Colors.accent,
  },
  sharePathText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.white,
  },
  captureContainer: {
    backgroundColor: '#FAF7F4',
    borderRadius: 20,
    marginHorizontal: 8,
    marginTop: 8,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: '#E8DED4',
  },
  captureTopBar: {
    height: 4,
    backgroundColor: Colors.primary,
  },
  captureHeader: {
    alignItems: 'center' as const,
    paddingTop: 20,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  capturePersonRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 14,
    flexWrap: 'wrap' as const,
    justifyContent: 'center' as const,
  },
  capturePersonPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8DED4',
    gap: 7,
    maxWidth: 160,
  },
  capturePersonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  captureArrowWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EDE5DD',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  capturePersonName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#2D2A26',
  },
  captureBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 8,
  },
  captureBadgeText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#fff',
  },
  captureReverseLabel: {
    fontSize: 11,
    color: '#8A8078',
    marginTop: 8,
    fontStyle: 'italic' as const,
  },
  captureFooterRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  captureFooterLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E0D8D0',
  },
  captureFooter: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: '#B8AFA5',
    textTransform: 'uppercase' as const,
    letterSpacing: 1.5,
  },
  noAncestorNote: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 24,
  },
  noAncestorText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  resultActions: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 16,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
    gap: 12,
  },
  swapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  swapButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
  resetButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
  },
  resetButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.white,
  },
});
