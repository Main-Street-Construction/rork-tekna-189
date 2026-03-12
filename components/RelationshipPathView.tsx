import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Crown, ChevronDown as DownArrow } from 'lucide-react-native';
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

  if (!commonAncestor) return null;

  const renderPersonNode = (
    personId: string,
    isEndpoint: boolean,
    isAncestor: boolean
  ) => {
    const person = data.individuals.get(personId);
    if (!person) return null;

    const genderColor =
      person.sex === 'F'
        ? Colors.female
        : person.sex === 'M'
          ? Colors.male
          : Colors.textSecondary;
    const initials =
      (person.givenName?.[0] ?? '') + (person.surname?.[0] ?? '');

    const NodeWrapper = isCapture ? View : TouchableOpacity;
    const wrapperProps = isCapture
      ? {}
      : { onPress: () => handlePress(personId), activeOpacity: 0.7 };

    return (
      <NodeWrapper
        key={personId}
        style={[
          styles.personNode,
          isEndpoint && styles.endpointNode,
          isAncestor && styles.ancestorNode,
          isCapture && styles.capturePersonNode,
        ]}
        {...(wrapperProps as any)}
      >
        <View
          style={[
            styles.nodeAvatar,
            { backgroundColor: isAncestor ? '#3B6B4A' : genderColor },
            isCapture && isAncestor && styles.captureAncestorAvatar,
            isCapture && isEndpoint && styles.captureEndpointAvatar,
          ]}
        >
          {isAncestor ? (
            <Crown size={isCapture ? 14 : 13} color="#fff" />
          ) : (
            <Text style={[styles.nodeAvatarText, isCapture && styles.captureAvatarText]}>{initials}</Text>
          )}
        </View>
        <View style={styles.nodeTextContainer}>
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
          {person.birthDate && (
            <Text style={[styles.nodeDate, isCapture && styles.captureNodeDate]}>
              {person.birthDate}
              {person.deathDate ? ` — ${person.deathDate}` : ''}
            </Text>
          )}
        </View>
      </NodeWrapper>
    );
  };

  const renderConnector = (key: string) => (
    <View key={key} style={[styles.connector, isCapture && styles.captureConnector]}>
      <View style={[styles.connectorLine, isCapture && styles.captureConnectorLine]} />
      <DownArrow size={isCapture ? 10 : 12} color={isCapture ? '#A49A8E' : Colors.accent} />
    </View>
  );

  const path1 = commonAncestor.pathFromAncestorToPerson1;
  const path2 = commonAncestor.pathFromAncestorToPerson2;

  const Container = isCapture ? View : ScrollView;
  const containerProps = isCapture
    ? { style: styles.captureContainerOuter }
    : { style: styles.container, contentContainerStyle: styles.content, showsVerticalScrollIndicator: false };

  return (
    <Container {...(containerProps as any)}>
      <View style={[styles.ancestorSection, isCapture && styles.captureAncestorSection]}>
        <View style={[styles.sectionLabelRow, isCapture && styles.captureSectionLabelRow]}>
          <View style={[styles.sectionLabelLine, isCapture && styles.captureSectionLabelLine]} />
          <Text style={[styles.sectionLabel, isCapture && styles.captureSectionLabel]}>Common Ancestor</Text>
          <View style={[styles.sectionLabelLine, isCapture && styles.captureSectionLabelLine]} />
        </View>
        {renderPersonNode(commonAncestor.ancestorId, false, true)}
      </View>

      <View style={[styles.branchContainer, isCapture && styles.captureBranchContainer]}>
        <View style={styles.branch}>
          <View style={styles.branchHeader}>
            <View style={[styles.branchDot, { backgroundColor: Colors.male }]} />
            <Text style={[styles.branchLabel, isCapture && styles.captureBranchLabel]}>
              To {person1.givenName}
            </Text>
          </View>
          {path1.slice(1).map((personId, idx) => (
            <View key={`p1-${idx}`}>
              {renderConnector(`c1-${idx}`)}
              {renderPersonNode(
                personId,
                personId === person1.id,
                false
              )}
            </View>
          ))}
          {path1.length <= 1 && (
            <Text style={styles.sameNote}>Same person</Text>
          )}
        </View>

        <View style={[styles.branchDivider, isCapture && styles.captureBranchDivider]} />

        <View style={styles.branch}>
          <View style={styles.branchHeader}>
            <View style={[styles.branchDot, { backgroundColor: Colors.female }]} />
            <Text style={[styles.branchLabel, isCapture && styles.captureBranchLabel]}>
              To {person2.givenName}
            </Text>
          </View>
          {path2.slice(1).map((personId, idx) => (
            <View key={`p2-${idx}`}>
              {renderConnector(`c2-${idx}`)}
              {renderPersonNode(
                personId,
                personId === person2.id,
                false
              )}
            </View>
          ))}
          {path2.length <= 1 && (
            <Text style={styles.sameNote}>Same person</Text>
          )}
        </View>
      </View>
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
    paddingVertical: 16,
  },
  captureAncestorSection: {
    paddingVertical: 12,
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
    letterSpacing: 1,
  },
  captureSectionLabel: {
    fontSize: 10,
    color: '#3B6B4A',
    letterSpacing: 1.5,
  },
  branchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
  },
  captureBranchContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  branch: {
    flex: 1,
    alignItems: 'center',
  },
  branchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    paddingVertical: 6,
  },
  branchDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  branchLabel: {
    fontSize: 12,
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
    marginTop: 30,
  },
  captureBranchDivider: {
    width: 1,
    backgroundColor: '#D5CCC2',
    marginTop: 30,
  },
  personNode: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    width: '100%',
    maxWidth: 180,
  },
  capturePersonNode: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    maxWidth: 200,
  },
  endpointNode: {
    borderColor: Colors.accent,
    borderWidth: 2,
    backgroundColor: 'rgba(200, 149, 108, 0.05)',
  },
  ancestorNode: {
    borderColor: '#3B6B4A',
    borderWidth: 2,
    backgroundColor: 'rgba(59, 107, 74, 0.06)',
    maxWidth: 240,
  },
  captureAncestorAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  captureEndpointAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  nodeAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nodeAvatarText: {
    color: Colors.white,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  captureAvatarText: {
    fontSize: 11,
  },
  nodeTextContainer: {
    flex: 1,
    marginLeft: 8,
  },
  nodeName: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  captureNodeName: {
    fontSize: 13,
  },
  endpointName: {
    color: Colors.accent,
    fontWeight: '700' as const,
  },
  ancestorName: {
    color: '#3B6B4A',
    fontWeight: '700' as const,
    fontSize: 14,
  },
  captureAncestorNameText: {
    fontSize: 15,
  },
  captureEndpointNameText: {
    fontWeight: '700' as const,
  },
  nodeDate: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  captureNodeDate: {
    fontSize: 10,
    color: '#8A8078',
  },
  connector: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
  },
  captureConnector: {
    height: 22,
  },
  connectorLine: {
    width: 2,
    height: 10,
    backgroundColor: Colors.cardBorder,
  },
  captureConnectorLine: {
    height: 8,
    backgroundColor: '#D5CCC2',
  },
  sameNote: {
    fontSize: 12,
    color: Colors.textLight,
    fontStyle: 'italic' as const,
    marginTop: 8,
  },
});
