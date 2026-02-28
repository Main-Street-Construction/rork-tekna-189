import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { ChevronDown, Crown, ArrowDown } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { GedcomIndividual, FamilyTreeData } from '@/types/genealogy';
import { CommonAncestorResult } from '@/utils/relationship';

interface RelationshipPathViewProps {
  person1: GedcomIndividual;
  person2: GedcomIndividual;
  commonAncestor: CommonAncestorResult | null;
  data: FamilyTreeData;
  onPersonPress?: (person: GedcomIndividual) => void;
}

export default React.memo(function RelationshipPathView({
  person1,
  person2,
  commonAncestor,
  data,
  onPersonPress,
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

    return (
      <TouchableOpacity
        key={personId}
        style={[
          styles.personNode,
          isEndpoint && styles.endpointNode,
          isAncestor && styles.ancestorNode,
        ]}
        onPress={() => handlePress(personId)}
        activeOpacity={0.7}
      >
        <View
          style={[
            styles.nodeAvatar,
            { backgroundColor: isAncestor ? Colors.success : genderColor },
          ]}
        >
          {isAncestor ? (
            <Crown size={13} color={Colors.white} />
          ) : (
            <Text style={styles.nodeAvatarText}>{initials}</Text>
          )}
        </View>
        <View style={styles.nodeTextContainer}>
          <Text
            style={[
              styles.nodeName,
              isEndpoint && styles.endpointName,
              isAncestor && styles.ancestorName,
            ]}
            numberOfLines={1}
          >
            {person.name}
          </Text>
          {person.birthDate && (
            <Text style={styles.nodeDate}>{person.birthDate}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderConnector = (key: string) => (
    <View key={key} style={styles.connector}>
      <View style={styles.connectorLine} />
      <ArrowDown size={12} color={Colors.accent} />
    </View>
  );

  const path1 = commonAncestor.pathFromAncestorToPerson1;
  const path2 = commonAncestor.pathFromAncestorToPerson2;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.ancestorSection}>
        <Text style={styles.sectionLabel}>Common Ancestor</Text>
        {renderPersonNode(commonAncestor.ancestorId, false, true)}
      </View>

      <View style={styles.branchContainer}>
        <View style={styles.branch}>
          <View style={styles.branchHeader}>
            <View style={styles.branchDot} />
            <Text style={styles.branchLabel}>
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

        <View style={styles.branchDivider} />

        <View style={styles.branch}>
          <View style={styles.branchHeader}>
            <View style={[styles.branchDot, styles.branchDot2]} />
            <Text style={styles.branchLabel}>
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
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 24,
  },
  ancestorSection: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.success,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 10,
  },
  branchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
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
    backgroundColor: Colors.male,
  },
  branchDot2: {
    backgroundColor: Colors.female,
  },
  branchLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  branchDivider: {
    width: 1,
    backgroundColor: Colors.cardBorder,
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
  endpointNode: {
    borderColor: Colors.accent,
    borderWidth: 2,
    backgroundColor: 'rgba(200, 149, 108, 0.05)',
  },
  ancestorNode: {
    borderColor: Colors.success,
    borderWidth: 2,
    backgroundColor: 'rgba(74, 124, 89, 0.05)',
    maxWidth: 240,
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
  nodeTextContainer: {
    flex: 1,
    marginLeft: 8,
  },
  nodeName: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  endpointName: {
    color: Colors.accent,
    fontWeight: '700' as const,
  },
  ancestorName: {
    color: Colors.success,
    fontWeight: '700' as const,
    fontSize: 14,
  },
  nodeDate: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  connector: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
  },
  connectorLine: {
    width: 2,
    height: 10,
    backgroundColor: Colors.cardBorder,
  },
  sameNote: {
    fontSize: 12,
    color: Colors.textLight,
    fontStyle: 'italic' as const,
    marginTop: 8,
  },
});
