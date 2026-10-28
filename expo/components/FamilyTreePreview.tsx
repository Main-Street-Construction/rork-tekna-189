import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Heart, Maximize2, Minimize2, Network } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import SectionHeader from '@/components/SectionHeader';
import type { GedcomIndividual } from '@/types/genealogy';

const COMPACT_CHILD_LIMIT = 6;
const COMPACT_SIBLING_LIMIT = 6;
const ROW_NODE_LIMIT = 8;

type TreeNodeLabel =
  | 'Self'
  | 'Father'
  | 'Mother'
  | 'Parent'
  | 'Spouse'
  | 'Son'
  | 'Daughter'
  | 'Child'
  | 'Brother'
  | 'Sister'
  | 'Sibling'
  | 'Grandfather'
  | 'Grandmother'
  | 'Grandparent'
  | 'Gt-Grandfather'
  | 'Gt-Grandmother'
  | 'Grandson'
  | 'Granddaughter';

function roleLabel(
  person: GedcomIndividual,
  kind:
    | 'parent'
    | 'spouse'
    | 'child'
    | 'sibling'
    | 'grandparent'
    | 'greatGrandparent'
    | 'grandchild'
): TreeNodeLabel {
  if (kind === 'spouse') return 'Spouse';
  if (kind === 'parent') {
    if (person.sex === 'M') return 'Father';
    if (person.sex === 'F') return 'Mother';
    return 'Parent';
  }
  if (kind === 'child') {
    if (person.sex === 'M') return 'Son';
    if (person.sex === 'F') return 'Daughter';
    return 'Child';
  }
  if (kind === 'sibling') {
    if (person.sex === 'M') return 'Brother';
    if (person.sex === 'F') return 'Sister';
    return 'Sibling';
  }
  if (kind === 'grandparent') {
    if (person.sex === 'M') return 'Grandfather';
    if (person.sex === 'F') return 'Grandmother';
    return 'Grandparent';
  }
  if (kind === 'greatGrandparent') {
    if (person.sex === 'M') return 'Gt-Grandfather';
    if (person.sex === 'F') return 'Gt-Grandmother';
    return 'Grandparent';
  }
  if (person.sex === 'M') return 'Grandson';
  if (person.sex === 'F') return 'Granddaughter';
  return 'Child';
}

function initialsOf(person: GedcomIndividual): string {
  return `${person.givenName?.[0] ?? ''}${person.surname?.[0] ?? ''}`;
}

function sexColor(sex: GedcomIndividual['sex']): string {
  if (sex === 'F') return Colors.female;
  if (sex === 'M') return Colors.male;
  return Colors.textSecondary;
}

function GenerationRow({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rowContent}
      style={styles.rowScroll}
    >
      {children}
    </ScrollView>
  );
}

function Connector() {
  return (
    <View style={styles.connector} accessibilityElementsHidden>
      <View style={styles.connectorLine} />
    </View>
  );
}

function TreePersonNode({
  person,
  label,
  onPress,
  compact,
}: {
  person: GedcomIndividual;
  label: TreeNodeLabel;
  onPress: (person: GedcomIndividual) => void;
  compact?: boolean;
}) {
  const color = sexColor(person.sex);
  return (
    <TouchableOpacity
      style={[styles.node, compact && styles.nodeCompact]}
      onPress={() => onPress(person)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${person.name}, ${label}`}
    >
      <View style={[styles.nodeAvatar, compact && styles.nodeAvatarCompact, { backgroundColor: color }]}>
        <Text style={[styles.nodeAvatarText, compact && styles.nodeAvatarTextCompact]}>
          {initialsOf(person)}
        </Text>
      </View>
      <Text style={styles.nodeName} numberOfLines={1}>
        {person.givenName || person.name}
      </Text>
      <Text style={styles.nodeLabel} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function MoreNode({ count, onPress }: { count: number; onPress?: () => void }) {
  return (
    <TouchableOpacity
      style={styles.moreNode}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${count} more`}
    >
      <Text style={styles.moreText}>+{count}</Text>
    </TouchableOpacity>
  );
}

export interface FamilyTreePreviewProps {
  person: GedcomIndividual;
  parents: GedcomIndividual[];
  spouses: GedcomIndividual[];
  children: GedcomIndividual[];
  siblings: GedcomIndividual[];
  grandparents: GedcomIndividual[];
  greatGrandparents: GedcomIndividual[];
  grandchildren: GedcomIndividual[];
  onPersonPress: (person: GedcomIndividual) => void;
  onExploreTree?: () => void;
}

/**
 * Compact, generation-stacked preview of nearby relatives.
 * Kept intentionally bounded — not a full-graph canvas.
 */
export default function FamilyTreePreview({
  person,
  parents,
  spouses,
  children,
  siblings,
  grandparents,
  greatGrandparents,
  grandchildren,
  onPersonPress,
  onExploreTree,
}: FamilyTreePreviewProps) {
  const [expanded, setExpanded] = useState(false);

  const hasTreeData =
    parents.length > 0 || spouses.length > 0 || children.length > 0 || siblings.length > 0;

  const canExpand = useMemo(
    () =>
      greatGrandparents.length > 0 ||
      siblings.length > 0 ||
      children.length > COMPACT_CHILD_LIMIT ||
      grandchildren.length > 0 ||
      grandparents.length > 4,
    [greatGrandparents.length, siblings.length, children.length, grandchildren.length, grandparents.length]
  );

  const toggleExpand = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((prev) => !prev);
  }, []);

  const visibleGrandparents = expanded ? grandparents : grandparents.slice(0, 4);
  const visibleChildren = expanded ? children : children.slice(0, COMPACT_CHILD_LIMIT);
  const visibleSiblings = expanded ? siblings : siblings.slice(0, COMPACT_SIBLING_LIMIT);
  const visibleGreat = expanded ? greatGrandparents.slice(0, ROW_NODE_LIMIT) : [];
  const visibleGrandchildren = expanded ? grandchildren.slice(0, ROW_NODE_LIMIT) : [];

  if (!hasTreeData) return null;

  const genderColor = sexColor(person.sex);

  return (
    <View style={styles.section}>
      <SectionHeader title="Family Tree" />
      <View style={styles.card}>
        {visibleGreat.length > 0 && (
          <>
            <GenerationRow>
              {visibleGreat.map((p) => (
                <TreePersonNode
                  key={p.id}
                  person={p}
                  label={roleLabel(p, 'greatGrandparent')}
                  onPress={onPersonPress}
                  compact
                />
              ))}
              {greatGrandparents.length > ROW_NODE_LIMIT && (
                <MoreNode count={greatGrandparents.length - ROW_NODE_LIMIT} />
              )}
            </GenerationRow>
            <Connector />
          </>
        )}

        {visibleGrandparents.length > 0 && (
          <>
            <GenerationRow>
              {visibleGrandparents.map((p) => (
                <TreePersonNode
                  key={p.id}
                  person={p}
                  label={roleLabel(p, 'grandparent')}
                  onPress={onPersonPress}
                  compact
                />
              ))}
              {!expanded && grandparents.length > 4 && (
                <MoreNode count={grandparents.length - 4} onPress={toggleExpand} />
              )}
            </GenerationRow>
            <Connector />
          </>
        )}

        {parents.length > 0 && (
          <>
            <GenerationRow>
              {parents.map((p) => (
                <TreePersonNode
                  key={p.id}
                  person={p}
                  label={roleLabel(p, 'parent')}
                  onPress={onPersonPress}
                />
              ))}
            </GenerationRow>
            <Connector />
          </>
        )}

        <GenerationRow>
          <View style={styles.centerNode} accessibilityLabel={`${person.name}, focus person`}>
            <View style={[styles.centerAvatar, { backgroundColor: genderColor }]}>
              <Text style={styles.centerAvatarText}>{initialsOf(person)}</Text>
            </View>
            <Text style={styles.centerName} numberOfLines={1}>
              {person.givenName || person.name}
            </Text>
          </View>

          {spouses.map((s) => (
            <React.Fragment key={s.id}>
              <View style={styles.spouseLink}>
                <View style={styles.spouseLine} />
                <Heart size={11} color={Colors.accent} fill={Colors.accent} />
                <View style={styles.spouseLine} />
              </View>
              <TreePersonNode
                person={s}
                label={roleLabel(s, 'spouse')}
                onPress={onPersonPress}
              />
            </React.Fragment>
          ))}
        </GenerationRow>

        {expanded && visibleSiblings.length > 0 && (
          <View style={styles.siblingBlock}>
            <Text style={styles.siblingHeading}>Siblings</Text>
            <GenerationRow>
              {visibleSiblings.map((s) => (
                <TreePersonNode
                  key={s.id}
                  person={s}
                  label={roleLabel(s, 'sibling')}
                  onPress={onPersonPress}
                  compact
                />
              ))}
              {siblings.length > visibleSiblings.length && (
                <MoreNode count={siblings.length - visibleSiblings.length} />
              )}
            </GenerationRow>
          </View>
        )}

        {visibleChildren.length > 0 && (
          <>
            <Connector />
            <GenerationRow>
              {visibleChildren.map((c) => (
                <TreePersonNode
                  key={c.id}
                  person={c}
                  label={roleLabel(c, 'child')}
                  onPress={onPersonPress}
                />
              ))}
              {!expanded && children.length > COMPACT_CHILD_LIMIT && (
                <MoreNode count={children.length - COMPACT_CHILD_LIMIT} onPress={toggleExpand} />
              )}
            </GenerationRow>
          </>
        )}

        {visibleGrandchildren.length > 0 && (
          <>
            <Connector />
            <GenerationRow>
              {visibleGrandchildren.map((gc) => (
                <TreePersonNode
                  key={gc.id}
                  person={gc}
                  label={roleLabel(gc, 'grandchild')}
                  onPress={onPersonPress}
                  compact
                />
              ))}
              {grandchildren.length > ROW_NODE_LIMIT && (
                <MoreNode count={grandchildren.length - ROW_NODE_LIMIT} />
              )}
            </GenerationRow>
          </>
        )}

        <View style={styles.actions}>
          {canExpand && (
            <TouchableOpacity
              style={styles.expandBtn}
              onPress={toggleExpand}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Collapse tree' : 'Expand tree'}
            >
              {expanded ? (
                <Minimize2 size={14} color={Colors.accent} />
              ) : (
                <Maximize2 size={14} color={Colors.accent} />
              )}
              <Text style={styles.expandBtnText}>
                {expanded ? 'Show less' : 'Show more'}
              </Text>
            </TouchableOpacity>
          )}
          {onExploreTree && (
            <TouchableOpacity
              style={styles.exploreBtn}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onExploreTree();
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Open full tree explorer"
            >
              <Network size={14} color={Colors.white} />
              <Text style={styles.exploreBtnText}>Explore tree</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 16,
  },
  card: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignItems: 'stretch',
  },
  rowScroll: {
    flexGrow: 0,
  },
  rowContent: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 8,
  },
  connector: {
    alignItems: 'center',
    height: 18,
    justifyContent: 'center',
  },
  connectorLine: {
    width: 1.5,
    height: 14,
    borderRadius: 1,
    backgroundColor: Colors.cardBorder,
  },
  node: {
    alignItems: 'center',
    width: 64,
  },
  nodeCompact: {
    width: 56,
  },
  nodeAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  nodeAvatarCompact: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  nodeAvatarText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  nodeAvatarTextCompact: {
    fontSize: 10,
  },
  nodeName: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
    width: '100%',
  },
  nodeLabel: {
    fontSize: 9,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 1,
    width: '100%',
  },
  centerNode: {
    alignItems: 'center',
    backgroundColor: 'rgba(200, 149, 108, 0.1)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    minWidth: 72,
  },
  centerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  centerAvatarText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  centerName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent,
    textAlign: 'center',
    maxWidth: 88,
  },
  spouseLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 2,
  },
  spouseLine: {
    width: 8,
    height: 1.5,
    backgroundColor: Colors.accentLight,
    borderRadius: 1,
  },
  moreNode: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 18,
  },
  moreText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  siblingBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.cardBorder,
  },
  siblingHeading: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  expandBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(200, 149, 108, 0.1)',
  },
  expandBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.accent,
  },
  exploreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: Colors.primary,
  },
  exploreBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },
});
