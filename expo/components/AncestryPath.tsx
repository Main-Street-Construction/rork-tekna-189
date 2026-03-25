import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronDown, Crown } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { GedcomIndividual, FamilyTreeData } from '@/types/genealogy';

interface AncestryPathProps {
  path: string[];
  data: FamilyTreeData;
  highlightIds?: string[];
  ancestorId?: string;
  onPersonPress?: (person: GedcomIndividual) => void;
}

export default React.memo(function AncestryPath({
  path,
  data,
  highlightIds = [],
  ancestorId,
  onPersonPress,
}: AncestryPathProps) {
  const handlePress = useCallback(
    (personId: string) => {
      const person = data.individuals.get(personId);
      if (person && onPersonPress) {
        onPersonPress(person);
      }
    },
    [data, onPersonPress]
  );

  if (path.length === 0) return null;

  return (
    <View style={styles.container}>
      {path.map((personId, index) => {
        const person = data.individuals.get(personId);
        if (!person) return null;

        const isHighlighted = highlightIds.includes(personId);
        const isAncestor = personId === ancestorId;
        const genderColor =
          person.sex === 'F'
            ? Colors.female
            : person.sex === 'M'
              ? Colors.male
              : Colors.textSecondary;
        const initials =
          (person.givenName?.[0] ?? '') + (person.surname?.[0] ?? '');

        return (
          <View key={personId + '-' + index} style={styles.nodeWrapper}>
            {index > 0 && (
              <View style={styles.connectorContainer}>
                <View style={styles.connectorLine} />
                <ChevronDown size={14} color={Colors.textLight} />
              </View>
            )}
            <TouchableOpacity
              style={[
                styles.personNode,
                isHighlighted && styles.personNodeHighlighted,
                isAncestor && styles.personNodeAncestor,
              ]}
              onPress={() => handlePress(personId)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.nodeAvatar,
                  { backgroundColor: genderColor },
                  isAncestor && styles.nodeAvatarAncestor,
                ]}
              >
                {isAncestor ? (
                  <Crown size={14} color={Colors.white} />
                ) : (
                  <Text style={styles.nodeAvatarText}>{initials}</Text>
                )}
              </View>
              <View style={styles.nodeInfo}>
                <Text
                  style={[
                    styles.nodeName,
                    isHighlighted && styles.nodeNameHighlighted,
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
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  nodeWrapper: {
    alignItems: 'center',
  },
  connectorContainer: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
  },
  connectorLine: {
    width: 2,
    height: 12,
    backgroundColor: Colors.cardBorder,
  },
  personNode: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    minWidth: 200,
    maxWidth: 280,
  },
  personNodeHighlighted: {
    borderColor: Colors.accent,
    borderWidth: 2,
    backgroundColor: 'rgba(200, 149, 108, 0.06)',
  },
  personNodeAncestor: {
    borderColor: Colors.success,
    borderWidth: 2,
    backgroundColor: 'rgba(74, 124, 89, 0.06)',
  },
  nodeAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nodeAvatarAncestor: {
    backgroundColor: Colors.success,
  },
  nodeAvatarText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  nodeInfo: {
    flex: 1,
    marginLeft: 10,
  },
  nodeName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  nodeNameHighlighted: {
    color: Colors.accent,
    fontWeight: '700' as const,
  },
  nodeDate: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
});
