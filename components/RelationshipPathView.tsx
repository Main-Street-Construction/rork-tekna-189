import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, Platform } from 'react-native';
import { Crown, ChevronDown as DownArrow, Sparkles } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { GedcomIndividual, FamilyTreeData } from '@/types/genealogy';
import { CommonAncestorResult } from '@/utils/relationship';

interface RelationshipPathViewProps {
  person1: GedcomIndividual;
  person2: GedcomIndividual;
  commonAncestor: CommonAncestorResult | null;
  data: FamilyTreeData;
  onPersonPress?: (person: GedcomIndividual) => void;
  isCapture?: boolean;
}

const BRANCH_COLORS = {
  left: { start: '#3B6B4A', mid: '#5B8A6A', end: '#5B7FA6' },
  right: { start: '#3B6B4A', mid: '#7A6B5A', end: '#B06A8F' },
};

function getConnectorColor(index: number, total: number, side: 'left' | 'right'): string {
  const colors = BRANCH_COLORS[side];
  if (total <= 1) return colors.start;
  const t = index / Math.max(total - 1, 1);
  if (t < 0.5) {
    return t < 0.25 ? colors.start : colors.mid;
  }
  return t < 0.75 ? colors.mid : colors.end;
}

export default React.memo(function RelationshipPathView({
  person1,
  person2,
  commonAncestor,
  data,
  onPersonPress,
  isCapture = false,
}: RelationshipPathViewProps) {
  const handlePress = useCallback(
    (personId: string) => {
      const person = data.individuals.get(personId);
      if (person && onPersonPress) {
        onPersonPress(person);
      }
    },
    [data, onPersonPress]
  );

  const path1 = commonAncestor?.pathFromAncestorToPerson1 ?? [];
  const path2 = commonAncestor?.pathFromAncestorToPerson2 ?? [];
  const maxBranchLen = Math.max(path1.length - 1, path2.length - 1, 0);

  const fadeAnims = useRef<Animated.Value[]>([]);

  const totalNodes = 1 + (path1.length - 1) + (path2.length - 1);
  if (fadeAnims.current.length !== totalNodes) {
    fadeAnims.current = Array.from({ length: totalNodes }, () => new Animated.Value(isCapture ? 1 : 0));
  }

  useEffect(() => {
    if (isCapture) return;
    const animations = fadeAnims.current.map((anim, i) =>
      Animated.timing(anim, {
        toValue: 1,
        duration: 280,
        delay: i * 60,
        useNativeDriver: true,
      })
    );
    Animated.stagger(40, animations).start();
  }, [isCapture]);

  if (!commonAncestor) return null;

  const renderPersonNode = (
    personId: string,
    isEndpoint: boolean,
    isAncestor: boolean,
    animIndex: number,
    genLabel?: string,
  ) => {
    const person = data.individuals.get(personId);
    if (!person) return null;

    const genderColor =
      person.sex === 'F'
        ? Colors.female
        : person.sex === 'M'
          ? Colors.male
          : Colors.textSecondary;
    const given = person.givenName ?? '';
    const sur = person.surname ?? '';
    const initials = (given[0] ?? '') + (sur[0] ?? '') || '?';

    const hasHandler = !!onPersonPress;
    const NodeWrapper = hasHandler ? TouchableOpacity : View;
    const wrapperProps = hasHandler
      ? { onPress: () => handlePress(personId), activeOpacity: 0.7 }
      : {};

    const fadeAnim = fadeAnims.current[animIndex] ?? new Animated.Value(1);

    return (
      <Animated.View
        key={personId}
        style={[
          { opacity: fadeAnim, transform: [{ scale: fadeAnim }] },
        ]}
      >
        <NodeWrapper
          style={[
            styles.personNode,
            isEndpoint && styles.endpointNode,
            isAncestor && styles.ancestorNode,
            isCapture && styles.capturePersonNode,
          ]}
          {...(wrapperProps as any)}
        >
          {isAncestor && (
            <View style={styles.ancestorHalo} />
          )}
          <View
            style={[
              styles.nodeAvatar,
              { backgroundColor: isAncestor ? '#3B6B4A' : genderColor },
              isAncestor && styles.ancestorAvatar,
              isCapture && isAncestor && styles.captureAncestorAvatar,
              isCapture && isEndpoint && styles.captureEndpointAvatar,
              isEndpoint && styles.endpointAvatar,
            ]}
          >
            {isAncestor ? (
              <Crown size={isCapture ? 16 : 15} color="#fff" />
            ) : (
              <Text style={[styles.nodeAvatarText, isCapture && styles.captureAvatarText]}>{initials}</Text>
            )}
          </View>
          <View style={styles.nodeTextContainer}>
            <View style={styles.nameRow}>
              <Text
                style={[
                  styles.nodeName,
                  isEndpoint && styles.endpointName,
                  isAncestor && styles.ancestorName,
                  isCapture && styles.captureNodeName,
                  isCapture && isAncestor && styles.captureAncestorNameText,
                  isCapture && isEndpoint && styles.captureEndpointNameText,
                ]}
                numberOfLines={1}
              >
                {person.name}
              </Text>
              {isEndpoint && (
                <Sparkles size={12} color={Colors.accent} style={{ marginLeft: 4 }} />
              )}
            </View>
            {person.birthDate ? (
              <Text style={[styles.nodeDate, isCapture && styles.captureNodeDate]}>{person.birthDate}{person.deathDate ? ` — ${person.deathDate}` : ''}</Text>
            ) : null}
          </View>
          {genLabel && (
            <View style={styles.genBadge}>
              <Text style={styles.genBadgeText}>{genLabel}</Text>
            </View>
          )}
        </NodeWrapper>
      </Animated.View>
    );
  };

  const renderConnector = (key: string, index: number, total: number, side: 'left' | 'right') => {
    const color = getConnectorColor(index, total, side);
    return (
      <View key={key} style={[styles.connector, isCapture && styles.captureConnector]}>
        <View style={[styles.connectorLine, { backgroundColor: color }, isCapture && styles.captureConnectorLine]} />
        <DownArrow size={isCapture ? 10 : 12} color={color} />
      </View>
    );
  };

  const renderForkLines = () => {
    return (
      <View style={styles.forkContainer}>
        <View style={styles.forkLine}>
          <View style={[styles.forkVertical, { backgroundColor: BRANCH_COLORS.left.start }]} />
        </View>
        <View style={styles.forkHorizontalRow}>
          <View style={[styles.forkHorizontalLeft, { backgroundColor: BRANCH_COLORS.left.start }]} />
          <View style={styles.forkCenterDot}>
            <View style={styles.forkDotInner} />
          </View>
          <View style={[styles.forkHorizontalRight, { backgroundColor: BRANCH_COLORS.right.start }]} />
        </View>
        <View style={styles.forkDropRow}>
          <View style={styles.forkDropLeft}>
            <View style={[styles.forkDropLine, { backgroundColor: BRANCH_COLORS.left.start }]} />
            <DownArrow size={10} color={BRANCH_COLORS.left.start} />
          </View>
          <View style={styles.forkDropSpacer} />
          <View style={styles.forkDropRight}>
            <View style={[styles.forkDropLine, { backgroundColor: BRANCH_COLORS.right.start }]} />
            <DownArrow size={10} color={BRANCH_COLORS.right.start} />
          </View>
        </View>
      </View>
    );
  };

  const Container = isCapture ? View : ScrollView;
  const containerProps = isCapture
    ? { style: styles.captureContainerOuter }
    : { style: styles.container, contentContainerStyle: styles.content, showsVerticalScrollIndicator: false };

  let animCounter = 0;
  const ancestorAnimIdx = animCounter++;

  return (
    <Container {...(containerProps as any)}>
      <View style={[styles.ancestorSection, isCapture && styles.captureAncestorSection]}>
        <View style={[styles.sectionLabelRow, isCapture && styles.captureSectionLabelRow]}>
          <View style={[styles.sectionLabelLine, isCapture && styles.captureSectionLabelLine]} />
          <Text style={[styles.sectionLabel, isCapture && styles.captureSectionLabel]}>Common Ancestor</Text>
          <View style={[styles.sectionLabelLine, isCapture && styles.captureSectionLabelLine]} />
        </View>
        {renderPersonNode(commonAncestor.ancestorId, false, true, ancestorAnimIdx)}
      </View>

      {renderForkLines()}
      <View style={[styles.fanContainer, isCapture && styles.captureFanContainer]}>
          <View style={styles.fanBranch}>
            <View style={styles.branchHeader}>
              <View style={[styles.branchDot, { backgroundColor: Colors.male }]} />
              <Text style={[styles.branchLabel, isCapture && styles.captureBranchLabel]}>{'To ' + (person1.givenName || '?')}</Text>
            </View>
            {path1.length > 1 ? (
              path1.slice(1).map((personId, idx) => {
                const currentAnimIdx = animCounter++;
                const isLast = personId === person1.id;
                const genNum = idx + 1;
                return (
                  <View key={`p1-${idx}`} style={styles.branchNodeWrap}>
                    {idx > 0 && renderConnector(`c1-${idx}`, idx, path1.length - 1, 'left')}
                    {renderPersonNode(
                      personId,
                      isLast,
                      false,
                      currentAnimIdx,
                      `Gen ${genNum}`,
                    )}
                  </View>
                );
              })
            ) : (
              <Text style={styles.sameNote}>Same person</Text>
            )}
          </View>

          <View style={[styles.branchDivider, isCapture && styles.captureBranchDivider]} />

          <View style={styles.fanBranch}>
            <View style={styles.branchHeader}>
              <View style={[styles.branchDot, { backgroundColor: Colors.female }]} />
              <Text style={[styles.branchLabel, isCapture && styles.captureBranchLabel]}>{'To ' + (person2.givenName || '?')}</Text>
            </View>
            {path2.length > 1 ? (
              path2.slice(1).map((personId, idx) => {
                const currentAnimIdx = animCounter++;
                const isLast = personId === person2.id;
                const genNum = idx + 1;
                return (
                  <View key={`p2-${idx}`} style={styles.branchNodeWrap}>
                    {idx > 0 && renderConnector(`c2-${idx}`, idx, path2.length - 1, 'right')}
                    {renderPersonNode(
                      personId,
                      isLast,
                      false,
                      currentAnimIdx,
                      `Gen ${genNum}`,
                    )}
                  </View>
                );
              })
            ) : (
              <Text style={styles.sameNote}>Same person</Text>
            )}
          </View>
        </View>

      {maxBranchLen > 4 && (
        <View style={styles.depthNote}>
          <Text style={styles.depthNoteText}>
            {maxBranchLen} generations deep
          </Text>
        </View>
      )}
    </Container>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 24,
  },
  captureContainerOuter: {
    paddingBottom: 8,
  },
  ancestorSection: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 4,
  },
  captureAncestorSection: {
    paddingTop: 12,
    paddingBottom: 2,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 20,
  },
  captureSectionLabelRow: {
    marginBottom: 12,
  },
  sectionLabelLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.cardBorder,
  },
  captureSectionLabelLine: {
    backgroundColor: '#D5CCC2',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.success,
    textTransform: 'uppercase' as const,
    letterSpacing: 1.2,
  },
  captureSectionLabel: {
    fontSize: 10,
    color: '#3B6B4A',
    letterSpacing: 1.5,
  },

  forkContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 2,
  },
  forkLine: {
    alignItems: 'center',
    height: 16,
  },
  forkVertical: {
    width: 2,
    height: 16,
    borderRadius: 1,
  },
  forkHorizontalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '70%',
    maxWidth: 260,
  },
  forkHorizontalLeft: {
    flex: 1,
    height: 2,
    borderTopLeftRadius: 4,
  },
  forkCenterDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(59, 107, 74, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  forkDotInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3B6B4A',
  },
  forkHorizontalRight: {
    flex: 1,
    height: 2,
    borderTopRightRadius: 4,
  },
  forkDropRow: {
    flexDirection: 'row',
    width: '70%',
    maxWidth: 260,
  },
  forkDropLeft: {
    alignItems: 'center',
    height: 20,
  },
  forkDropSpacer: {
    flex: 1,
  },
  forkDropRight: {
    alignItems: 'center',
    height: 20,
  },
  forkDropLine: {
    width: 2,
    height: 10,
    borderRadius: 1,
  },

  fanContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 6,
  },
  captureFanContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  fanBranch: {
    flex: 1,
    alignItems: 'center',
  },
  branchNodeWrap: {
    alignItems: 'center',
    width: '100%',
  },
  branchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(44, 57, 48, 0.04)',
    borderRadius: 12,
  },
  branchDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  branchLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  captureBranchLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#6B6158',
  },
  branchDivider: {
    width: 1,
    backgroundColor: Colors.cardBorder,
    marginTop: 36,
    opacity: 0.6,
  },
  captureBranchDivider: {
    width: 1,
    backgroundColor: '#D5CCC2',
    marginTop: 36,
  },

  personNode: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    width: '100%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
      default: {},
    }),
  },
  capturePersonNode: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  endpointNode: {
    borderColor: Colors.accent,
    borderWidth: 2,
    backgroundColor: 'rgba(200, 149, 108, 0.06)',
    ...Platform.select({
      ios: {
        shadowColor: Colors.accent,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
      },
      android: {
        elevation: 3,
      },
      default: {},
    }),
  },
  ancestorNode: {
    borderColor: '#3B6B4A',
    borderWidth: 2,
    backgroundColor: 'rgba(59, 107, 74, 0.06)',
    maxWidth: 280,
    paddingVertical: 10,
    paddingHorizontal: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#3B6B4A',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
      default: {},
    }),
  },
  ancestorHalo: {
    position: 'absolute',
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 18,
    backgroundColor: 'rgba(59, 107, 74, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(59, 107, 74, 0.08)',
  },
  ancestorAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  endpointAvatar: {
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  captureAncestorAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  captureEndpointAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  nodeAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nodeAvatarText: {
    color: Colors.white,
    fontSize: 9,
    fontWeight: '700' as const,
  },
  captureAvatarText: {
    fontSize: 11,
  },
  nodeTextContainer: {
    flex: 1,
    marginLeft: 6,
    overflow: 'hidden',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nodeName: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.text,
    flexShrink: 1,
  },
  captureNodeName: {
    fontSize: 12,
  },
  endpointName: {
    color: Colors.accent,
    fontWeight: '700' as const,
  },
  ancestorName: {
    color: '#3B6B4A',
    fontWeight: '700' as const,
    fontSize: 13,
  },
  captureAncestorNameText: {
    fontSize: 14,
  },
  captureEndpointNameText: {
    fontWeight: '700' as const,
  },
  nodeDate: {
    fontSize: 9,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  captureNodeDate: {
    fontSize: 10,
    color: '#8A8078',
  },
  genBadge: {
    position: 'absolute',
    top: -7,
    right: -2,
    backgroundColor: Colors.backgroundDark,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  genBadgeText: {
    fontSize: 8,
    fontWeight: '700' as const,
    color: Colors.textLight,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  connector: {
    alignItems: 'center',
    height: 22,
    justifyContent: 'center',
  },
  captureConnector: {
    height: 20,
  },
  connectorLine: {
    width: 2,
    height: 10,
    borderRadius: 1,
  },
  captureConnectorLine: {
    height: 10,
  },
  sameNote: {
    fontSize: 12,
    color: Colors.textLight,
    fontStyle: 'italic' as const,
    marginTop: 8,
  },
  depthNote: {
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  depthNoteText: {
    fontSize: 11,
    color: Colors.textLight,
    fontWeight: '500' as const,
    fontStyle: 'italic' as const,
  },
});
