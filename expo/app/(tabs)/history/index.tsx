import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Clock, Search, Trash2, ArrowRight, User, GitFork } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useSearchHistory } from '@/contexts/SearchHistoryContext';
import { useAuth } from '@/contexts/AuthContext';
import { SearchHistoryItem } from '@/types/genealogy';
import EmptyState from '@/components/EmptyState';
import AuthGate from '@/components/AuthGate';

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export default function HistoryScreen() {
  const { isSignedIn, isEnabled } = useAuth();

  if (!isSignedIn || !isEnabled) {
    return <AuthGate><View style={styles.container} /></AuthGate>;
  }

  return <HistoryScreenContent />;
}

function HistoryScreenContent() {
  const router = useRouter();
  const { history, clearHistory } = useSearchHistory();

  const handleClear = useCallback(() => {
    Alert.alert(
      'Clear History',
      'Are you sure you want to clear all history?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            clearHistory();
          },
        },
      ]
    );
  }, [clearHistory]);

  const handleItemPress = useCallback(
    (item: SearchHistoryItem) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (item.type === 'relationship' && item.person1Id) {
        router.push(`/person/${item.person1Id}`);
      } else if (item.selectedPersonId) {
        router.push(`/person/${item.selectedPersonId}`);
      }
    },
    [router]
  );

  const renderRelationshipItem = useCallback(
    (item: SearchHistoryItem) => (
      <TouchableOpacity
        style={styles.historyItem}
        onPress={() => handleItemPress(item)}
        activeOpacity={0.7}
        testID={`history-item-${item.id}`}
      >
        <View style={[styles.itemIcon, styles.itemIconRelationship]}>
          <GitFork size={16} color={Colors.accent} />
        </View>
        <View style={styles.itemContent}>
          <View style={styles.relationshipNames}>
            <Text style={styles.relationshipName} numberOfLines={1}>
              {item.person1Name}
            </Text>
            <ArrowRight size={12} color={Colors.textLight} />
            <Text style={styles.relationshipName} numberOfLines={1}>
              {item.person2Name}
            </Text>
          </View>
          <View style={styles.relationshipResultRow}>
            <View style={styles.relationshipBadge}>
              <Text style={styles.relationshipBadgeText} numberOfLines={1}>
                {item.relationshipResult}
              </Text>
            </View>
            {(item.pathCount ?? 0) > 0 && (
              <Text style={styles.pathCountText}>
                {item.pathCount} path{item.pathCount !== 1 ? 's' : ''}
              </Text>
            )}
          </View>
          <Text style={styles.itemTime}>{formatTimeAgo(item.timestamp)}</Text>
        </View>
      </TouchableOpacity>
    ),
    [handleItemPress]
  );

  const renderSearchItem = useCallback(
    (item: SearchHistoryItem) => (
      <TouchableOpacity
        style={styles.historyItem}
        onPress={() => handleItemPress(item)}
        activeOpacity={0.7}
        testID={`history-item-${item.id}`}
      >
        <View style={styles.itemIcon}>
          {item.selectedPersonId ? (
            <User size={16} color={Colors.accent} />
          ) : (
            <Search size={16} color={Colors.textSecondary} />
          )}
        </View>
        <View style={styles.itemContent}>
          {item.selectedPersonName ? (
            <Text style={styles.itemName} numberOfLines={1}>
              {item.selectedPersonName}
            </Text>
          ) : null}
          <View style={styles.itemMeta}>
            <Text style={styles.itemQuery} numberOfLines={1}>
              Searched: &quot;{item.query}&quot;
            </Text>
            <Text style={styles.itemDot}>·</Text>
            <Text style={styles.itemResults}>
              {item.resultCount} result{item.resultCount !== 1 ? 's' : ''}
            </Text>
          </View>
          <Text style={styles.itemTime}>{formatTimeAgo(item.timestamp)}</Text>
        </View>
        {item.selectedPersonId && (
          <ArrowRight size={16} color={Colors.textLight} />
        )}
      </TouchableOpacity>
    ),
    [handleItemPress]
  );

  const renderItem = useCallback(
    ({ item }: { item: SearchHistoryItem }) => {
      if (item.type === 'relationship') {
        return renderRelationshipItem(item);
      }
      return renderSearchItem(item);
    },
    [renderRelationshipItem, renderSearchItem]
  );

  if (history.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon={<Clock size={28} color={Colors.textLight} />}
          title="No History"
          description="Your searches and relationship calculations will appear here for easy access."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.headerRow}>
            <Text style={styles.headerText}>
              {history.length} item{history.length !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity
              style={styles.clearButton}
              onPress={handleClear}
            >
              <Trash2 size={14} color={Colors.danger} />
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  listContent: {
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(196, 92, 74, 0.08)',
  },
  clearText: {
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '600' as const,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemIconRelationship: {
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
  },
  itemContent: {
    flex: 1,
    marginLeft: 12,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemQuery: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
  },
  itemDot: {
    fontSize: 13,
    color: Colors.textLight,
    marginHorizontal: 6,
  },
  itemResults: {
    fontSize: 12,
    color: Colors.textLight,
  },
  itemTime: {
    fontSize: 11,
    color: Colors.textLight,
    marginTop: 3,
  },
  relationshipNames: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  relationshipName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    flexShrink: 1,
  },
  relationshipResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  relationshipBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  relationshipBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.white,
  },
  pathCountText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
});
