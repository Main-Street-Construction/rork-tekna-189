import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { MapPin, Calendar, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { GedcomIndividual } from '@/types/genealogy';

interface PersonCardProps {
  person: GedcomIndividual;
  onPress: (person: GedcomIndividual) => void;
  subtitle?: string;
  compact?: boolean;
}

export default React.memo(function PersonCard({
  person,
  onPress,
  subtitle,
  compact = false,
}: PersonCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(person);
  };

  const genderColor = person.sex === 'F' ? Colors.female : person.sex === 'M' ? Colors.male : Colors.textSecondary;
  const given = person.givenName ?? '';
  const sur = person.surname ?? '';
  const initials = (given[0] ?? '') + (sur[0] ?? '') || '?';

  const lifespan = [person.birthDate, person.deathDate]
    .filter(Boolean)
    .join(' — ');

  if (compact) {
    return (
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.8}
        testID={`person-card-${person.id}`}
      >
        <Animated.View
          style={[styles.compactCard, { transform: [{ scale: scaleAnim }] }]}
        >
          <View style={[styles.compactAvatar, { backgroundColor: genderColor }]}>
            <Text style={styles.compactAvatarText}>{initials}</Text>
          </View>
          <View style={styles.compactInfo}>
            <Text style={styles.compactName} numberOfLines={1}>
              {person.name}
            </Text>
            {subtitle ? (
              <Text style={styles.compactSubtitle}>{subtitle}</Text>
            ) : lifespan ? (
              <Text style={styles.compactSubtitle}>{lifespan}</Text>
            ) : null}
          </View>
          <ChevronRight size={16} color={Colors.textLight} />
        </Animated.View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={0.8}
      testID={`person-card-${person.id}`}
    >
      <Animated.View
        style={[styles.card, { transform: [{ scale: scaleAnim }] }]}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.avatar, { backgroundColor: genderColor }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.name} numberOfLines={1}>
              {person.name}
            </Text>
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
          <ChevronRight size={18} color={Colors.textLight} />
        </View>

        {(lifespan || person.birthPlace) && (
          <View style={styles.cardDetails}>
            {lifespan ? (
              <View style={styles.detailRow}>
                <Calendar size={13} color={Colors.textSecondary} />
                <Text style={styles.detailText}>{lifespan}</Text>
              </View>
            ) : null}
            {person.birthPlace ? (
              <View style={styles.detailRow}>
                <MapPin size={13} color={Colors.textSecondary} />
                <Text style={styles.detailText} numberOfLines={1}>
                  {person.birthPlace}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
  },
  headerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.accent,
    marginTop: 2,
    fontWeight: '500' as const,
  },
  cardDetails: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
  },
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  compactAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactAvatarText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  compactInfo: {
    flex: 1,
    marginLeft: 10,
  },
  compactName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  compactSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
});
