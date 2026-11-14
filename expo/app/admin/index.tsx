import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TextInput,
  Switch,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import {
  ShieldCheck,
  ShieldOff,
  Users,
  Mail,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Trash2,
  Clock,
  UserCheck,
  ClipboardList,
  Database,
  Search,
  ChevronRight,
  Bell,
  X,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useColors, type ColorPalette } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { navigateBack } from '@/utils/navigation';
import { supabase } from '@/lib/supabase';
import { flushPendingAccessNotifications } from '@/lib/supabase-rpc';
import {
  adminDeleteUser,
  adminListUsersWithEmail,
  adminResetUserClaim,
  type AdminUserRow,
} from '@/lib/supabase-rpc';

type AdminTab = 'requests' | 'people';

export default function AdminScreen() {
  const Colors = useColors();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAdmin, user } = useAuth();
  const { pendingEditCount, refreshPendingCount } = useFamilyTree();
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>('requests');
  const [query, setQuery] = useState('');
  const [peopleFilter, setPeopleFilter] = useState<'all' | 'pending' | 'enabled' | 'admins'>('all');
  const [notifyStatus, setNotifyStatus] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['adminUsersList'],
    queryFn: async (): Promise<AdminUserRow[]> => {
      const { users, error } = await adminListUsersWithEmail();
      if (error) {
        const { data, error: fbErr } = await supabase.rpc('admin_list_users');
        if (!fbErr && data) {
          return (data as Array<{ id: string; is_enabled: boolean; is_admin: boolean; created_at: string | null }>).map((r) => ({
            ...r,
            email: null,
            full_name: null,
            email_confirmed: false,
            last_sign_in_at: null,
            claimed_gedcom_id: null,
            claimed_person_name: null,
          }));
        }
        throw new Error(error);
      }
      return users;
    },
    enabled: isAdmin,
    refetchInterval: isAdmin ? 20_000 : false,
  });

  // Live updates when profiles change (new signups) — no pull-to-refresh required
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel('admin-profiles')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, queryClient]);

  // Flush any missed push notifications + refresh lists whenever admin opens this screen
  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) return;
      let cancelled = false;
      void (async () => {
        setNotifyStatus('Checking for new requests…');
        await flushPendingAccessNotifications();
        if (cancelled) return;
        await queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
        await refreshPendingCount();
        if (!cancelled) setNotifyStatus(null);
      })();
      return () => {
        cancelled = true;
      };
    }, [isAdmin, refreshPendingCount, queryClient])
  );

  const updateUserMutation = useMutation({
    mutationFn: async (params: {
      targetUserId: string;
      setIsEnabled?: boolean;
      setIsAdmin?: boolean;
    }) => {
      const { data, error } = await supabase.rpc('admin_update_user', {
        target_user_id: params.targetUserId,
        set_is_enabled: params.setIsEnabled ?? null,
        set_is_admin: params.setIsAdmin ?? null,
      });
      if (error) throw new Error(error.message);
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error ?? 'Update failed');
      return result;
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
    },
    onError: (error: Error) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', error.message);
    },
    onSettled: () => setUpdatingUserId(null),
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      const result = await adminDeleteUser(targetUserId);
      if (!result.success) throw new Error(result.error ?? 'Delete failed');
      return result;
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
    onSettled: () => setUpdatingUserId(null),
  });

  const resetClaimMutation = useMutation({
    mutationFn: (targetUserId: string) => adminResetUserClaim(targetUserId),
    onSuccess: (result) => {
      if (!result.success) {
        Alert.alert('Error', result.error ?? 'Failed to reset claim');
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['adminUsersList'] });
    },
  });

  const users = usersQuery.data ?? [];

  const displayName = useCallback((u: AdminUserRow) => {
    if (u.full_name?.trim()) return u.full_name.trim();
    return u.email ?? u.id.slice(0, 8) + '…';
  }, []);

  const matchesQuery = useCallback(
    (u: AdminUserRow, q: string) => {
      if (!q) return true;
      const haystacks = [
        u.full_name,
        u.email,
        u.claimed_person_name,
        u.claimed_gedcom_id,
        u.id,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      // Prefer prefix matches on name/email for ranking feel
      return haystacks.some((h) => h.includes(q));
    },
    []
  );

  const sortByName = useCallback(
    (a: AdminUserRow, b: AdminUserRow) =>
      displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' }),
    [displayName]
  );

  const sortPendingNewest = useCallback((a: AdminUserRow, b: AdminUserRow) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  }, []);

  const normalizedQuery = query.trim().toLowerCase();

  const pendingUsers = useMemo(
    () =>
      users
        .filter((u) => !u.is_enabled)
        .filter((u) => matchesQuery(u, normalizedQuery))
        .sort(sortPendingNewest),
    [users, matchesQuery, normalizedQuery, sortPendingNewest]
  );

  const enabledCount = users.filter((u) => u.is_enabled).length;

  /** People tab: group into Pending → Admins → Members for scanning */
  const peopleGroups = useMemo(() => {
    let list = users.filter((u) => matchesQuery(u, normalizedQuery));
    if (peopleFilter === 'pending') list = list.filter((u) => !u.is_enabled);
    if (peopleFilter === 'enabled') list = list.filter((u) => u.is_enabled);
    if (peopleFilter === 'admins') list = list.filter((u) => u.is_admin);

    const pending = list.filter((u) => !u.is_enabled).sort(sortPendingNewest);
    const admins = list
      .filter((u) => u.is_enabled && u.is_admin)
      .sort(sortByName);
    const members = list
      .filter((u) => u.is_enabled && !u.is_admin)
      .sort(sortByName);

    return {
      pending,
      admins,
      members,
      total: pending.length + admins.length + members.length,
    };
  }, [users, peopleFilter, normalizedQuery, matchesQuery, sortByName, sortPendingNewest]);

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleApprove = useCallback(
    (targetUser: AdminUserRow) => {
      setUpdatingUserId(targetUser.id);
      updateUserMutation.mutate({ targetUserId: targetUser.id, setIsEnabled: true });
    },
    [updateUserMutation]
  );

  const handleToggleEnabled = useCallback(
    (targetUser: AdminUserRow) => {
      const newValue = !targetUser.is_enabled;
      Alert.alert(
        `${newValue ? 'Enable' : 'Disable'} User`,
        `Are you sure you want to ${newValue ? 'enable' : 'disable'} ${displayName(targetUser)}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: newValue ? 'Enable' : 'Disable',
            style: newValue ? 'default' : 'destructive',
            onPress: () => {
              setUpdatingUserId(targetUser.id);
              updateUserMutation.mutate({ targetUserId: targetUser.id, setIsEnabled: newValue });
            },
          },
        ]
      );
    },
    [updateUserMutation]
  );

  const handleDeleteUser = useCallback(
    (targetUser: AdminUserRow) => {
      if (targetUser.id === user?.id) {
        Alert.alert('Cannot Delete', 'You cannot delete your own account.');
        return;
      }
      Alert.alert('Delete User', `Permanently delete ${displayName(targetUser)}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setUpdatingUserId(targetUser.id);
            deleteUserMutation.mutate(targetUser.id);
          },
        },
      ]);
    },
    [deleteUserMutation, user?.id]
  );

  const handleToggleAdmin = useCallback(
    (targetUser: AdminUserRow) => {
      if (targetUser.id === user?.id) {
        Alert.alert('Cannot Change', 'You cannot revoke your own admin status.');
        return;
      }
      const newValue = !targetUser.is_admin;
      Alert.alert(
        `${newValue ? 'Grant' : 'Revoke'} Admin`,
        `Are you sure you want to ${newValue ? 'grant admin to' : 'revoke admin from'} ${displayName(targetUser)}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: newValue ? 'Grant' : 'Revoke',
            onPress: () => {
              setUpdatingUserId(targetUser.id);
              updateUserMutation.mutate({ targetUserId: targetUser.id, setIsAdmin: newValue });
            },
          },
        ]
      );
    },
    [updateUserMutation, user?.id]
  );

  const renderRequestCard = (u: AdminUserRow) => {
    const isUpdating = updatingUserId === u.id;
    const createdDate = formatDate(u.created_at);

    return (
      <View key={u.id} style={styles.requestCard}>
        <View style={styles.requestHeader}>
          <View style={styles.requestAvatar}>
            <Mail size={18} color={Colors.accent} />
          </View>
          <View style={styles.requestInfo}>
            <Text style={styles.requestName} numberOfLines={1}>
              {displayName(u)}
            </Text>
            {u.email && u.full_name?.trim() ? (
              <Text style={styles.requestEmail} numberOfLines={1}>
                {u.email}
              </Text>
            ) : null}
            <View style={styles.metaRow}>
              {createdDate ? <Text style={styles.metaText}>Joined {createdDate}</Text> : null}
              {u.email_confirmed ? (
                <View style={styles.pillOk}>
                  <CheckCircle size={10} color={Colors.success} />
                  <Text style={styles.pillOkText}>Email confirmed</Text>
                </View>
              ) : (
                <View style={styles.pillWarn}>
                  <XCircle size={10} color={Colors.danger} />
                  <Text style={styles.pillWarnText}>Email unconfirmed</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {isUpdating ? (
          <View style={styles.requestActions}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <View style={styles.requestActions}>
            <TouchableOpacity
              style={styles.denyBtn}
              onPress={() => handleDeleteUser(u)}
              activeOpacity={0.8}
            >
              <Trash2 size={15} color={Colors.danger} />
              <Text style={styles.denyBtnText}>Remove</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.approveBtn}
              onPress={() => handleApprove(u)}
              activeOpacity={0.8}
            >
              <UserCheck size={16} color={Colors.white} />
              <Text style={styles.approveBtnText}>Approve</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderPeopleCard = (u: AdminUserRow) => {
    const isSelf = u.id === user?.id;
    const isUpdating = updatingUserId === u.id;

    return (
      <View key={u.id} style={[styles.peopleCard, isSelf && styles.peopleCardSelf]}>
        <View style={styles.peopleHeader}>
          <View style={[styles.peopleIcon, u.is_admin && styles.peopleIconAdmin]}>
            {u.is_admin ? (
              <ShieldCheck size={16} color={Colors.success} />
            ) : (
              <Users size={16} color={Colors.textSecondary} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.peopleName} numberOfLines={1}>
                {displayName(u)}
              </Text>
              {isSelf ? (
                <View style={styles.youBadge}>
                  <Text style={styles.youBadgeText}>You</Text>
                </View>
              ) : null}
              {!u.is_enabled ? (
                <View style={styles.pendingMini}>
                  <Text style={styles.pendingMiniText}>Pending</Text>
                </View>
              ) : null}
            </View>
            {u.email ? (
              <Text style={styles.peopleEmail} numberOfLines={1}>
                {u.email}
              </Text>
            ) : null}
            {u.claimed_person_name || u.claimed_gedcom_id ? (
              <Text style={styles.claimText} numberOfLines={1}>
                Claimed: {u.claimed_person_name ?? u.claimed_gedcom_id}
              </Text>
            ) : null}
          </View>
        </View>

        {isUpdating ? (
          <View style={styles.togglesRow}>
            <ActivityIndicator size="small" color={Colors.accent} style={{ margin: 12 }} />
          </View>
        ) : (
          <View style={styles.togglesRow}>
            <View style={styles.toggleItem}>
              <Text style={styles.toggleLabel}>Access</Text>
              <Switch
                value={u.is_enabled}
                onValueChange={() => handleToggleEnabled(u)}
                trackColor={{ false: Colors.cardBorder, true: Colors.success }}
                thumbColor={Colors.white}
              />
            </View>
            <View style={styles.toggleDivider} />
            <View style={styles.toggleItem}>
              <Text style={styles.toggleLabel}>Admin</Text>
              <Switch
                value={u.is_admin}
                onValueChange={() => handleToggleAdmin(u)}
                disabled={isSelf}
                trackColor={{ false: Colors.cardBorder, true: Colors.accent }}
                thumbColor={Colors.white}
              />
            </View>
            {!isSelf ? (
              <>
                <View style={styles.toggleDivider} />
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteUser(u)}>
                  <Trash2 size={16} color={Colors.danger} />
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        )}

        {u.claimed_gedcom_id && !isSelf ? (
          <TouchableOpacity
            style={styles.resetClaimBtn}
            onPress={() => {
              Alert.alert('Reset Claim', `Clear identity claim for ${displayName(u)}?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Reset', onPress: () => resetClaimMutation.mutate(u.id) },
              ]);
            }}
          >
            <Text style={styles.resetClaimText}>Reset identity claim</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  if (!isAdmin) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Admin' }} />
        <View style={styles.emptyContainer}>
          <ShieldOff size={48} color={Colors.textLight} />
          <Text style={styles.emptyTitle}>Access Denied</Text>
          <Text style={styles.emptyDesc}>You don't have admin privileges.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigateBack(router)}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Admin',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false,
        }}
      />

      {usersQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      ) : usersQuery.error ? (
        <View style={styles.emptyContainer}>
          <AlertTriangle size={48} color={Colors.danger} />
          <Text style={styles.emptyDesc}>
            {usersQuery.error instanceof Error ? usersQuery.error.message : 'Unknown error'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void usersQuery.refetch()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={usersQuery.isRefetching}
              onRefresh={() => {
                void flushPendingAccessNotifications();
                void usersQuery.refetch();
                void refreshPendingCount();
              }}
              tintColor={Colors.accent}
            />
          }
        >
          <Text style={styles.pageTitle}>Admin Console</Text>
          <Text style={styles.pageSubtitle}>
            Approve new members, review tree edits, and manage accounts.
          </Text>

          {notifyStatus ? (
            <View style={styles.notifyBanner}>
              <Bell size={14} color={Colors.accent} />
              <Text style={styles.notifyBannerText}>{notifyStatus}</Text>
            </View>
          ) : null}

          <View style={styles.toolGrid}>
            <TouchableOpacity
              style={[styles.toolCard, pendingUsers.length > 0 && styles.toolCardAlert]}
              onPress={() => setTab('requests')}
              activeOpacity={0.85}
            >
              <Clock size={20} color={pendingUsers.length > 0 ? Colors.accent : Colors.textSecondary} />
              <Text style={styles.toolTitle}>Access requests</Text>
              <Text style={styles.toolCount}>{pendingUsers.length}</Text>
              <Text style={styles.toolHint}>waiting for approval</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolCard}
              onPress={() => router.push('/pending-edits')}
              activeOpacity={0.85}
            >
              <ClipboardList size={20} color={Colors.textSecondary} />
              <Text style={styles.toolTitle}>Tree edits</Text>
              <Text style={styles.toolCount}>{pendingEditCount}</Text>
              <View style={styles.toolLinkRow}>
                <Text style={styles.toolHint}>review queue</Text>
                <ChevronRight size={12} color={Colors.textLight} />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolCard}
              onPress={() => router.push('/admin/data')}
              activeOpacity={0.85}
            >
              <Database size={20} color={Colors.textSecondary} />
              <Text style={styles.toolTitle}>Genealogy data</Text>
              <Text style={styles.toolCount}>{enabledCount}</Text>
              <View style={styles.toolLinkRow}>
                <Text style={styles.toolHint}>enabled users · console</Text>
                <ChevronRight size={12} color={Colors.textLight} />
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Search size={16} color={Colors.textLight} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or email…"
              placeholderTextColor={Colors.textLight}
              value={query}
              onChangeText={(text) => {
                setQuery(text);
                if (text.trim() && tab === 'requests') setTab('people');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={10}
                accessibilityLabel="Clear search"
              >
                <X size={16} color={Colors.textLight} />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.segment}>
            <TouchableOpacity
              style={[styles.segmentBtn, tab === 'requests' && styles.segmentBtnActive]}
              onPress={() => setTab('requests')}
            >
              <Text style={[styles.segmentText, tab === 'requests' && styles.segmentTextActive]}>
                Requests{pendingUsers.length ? ` (${pendingUsers.length})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentBtn, tab === 'people' && styles.segmentBtnActive]}
              onPress={() => setTab('people')}
            >
              <Text style={[styles.segmentText, tab === 'people' && styles.segmentTextActive]}>
                People ({users.length})
              </Text>
            </TouchableOpacity>
          </View>

          {tab === 'requests' ? (
            pendingUsers.length === 0 ? (
              <View style={styles.caughtUp}>
                <CheckCircle size={28} color={Colors.success} />
                <Text style={styles.caughtUpTitle}>
                  {normalizedQuery ? 'No matching requests' : 'All caught up'}
                </Text>
                <Text style={styles.caughtUpDesc}>
                  {normalizedQuery
                    ? 'Try a different name or email, or switch to People.'
                    : 'New signups will appear here automatically. Push alerts also fire when someone requests access.'}
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionHint}>
                  Newest first · Tap Approve to let them into the tree
                </Text>
                {pendingUsers.map(renderRequestCard)}
              </>
            )
          ) : (
            <>
              <View style={styles.filterRow}>
                {(
                  [
                    { key: 'all' as const, label: 'All' },
                    { key: 'pending' as const, label: 'Pending' },
                    { key: 'enabled' as const, label: 'Enabled' },
                    { key: 'admins' as const, label: 'Admins' },
                  ] as const
                ).map((f) => (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.filterChip, peopleFilter === f.key && styles.filterChipActive]}
                    onPress={() => setPeopleFilter(f.key)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        peopleFilter === f.key && styles.filterChipTextActive,
                      ]}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {normalizedQuery ? (
                <Text style={styles.matchCount}>
                  {peopleGroups.total} match{peopleGroups.total === 1 ? '' : 'es'} for “{query.trim()}”
                </Text>
              ) : null}

              {peopleGroups.total === 0 ? (
                <View style={styles.caughtUp}>
                  <Search size={28} color={Colors.textLight} />
                  <Text style={styles.caughtUpTitle}>No people found</Text>
                  <Text style={styles.caughtUpDesc}>
                    {normalizedQuery
                      ? 'No name or email matches that search.'
                      : 'No users in this filter.'}
                  </Text>
                </View>
              ) : (
                <>
                  {peopleGroups.pending.length > 0 && peopleFilter !== 'enabled' && peopleFilter !== 'admins' ? (
                    <View style={styles.groupBlock}>
                      <View style={styles.groupHeader}>
                        <Clock size={14} color={Colors.accent} />
                        <Text style={styles.groupTitle}>
                          Pending access ({peopleGroups.pending.length})
                        </Text>
                      </View>
                      <Text style={styles.groupHint}>Waiting for approval · newest first</Text>
                      {peopleGroups.pending.map(renderPeopleCard)}
                    </View>
                  ) : null}

                  {peopleGroups.admins.length > 0 && peopleFilter !== 'pending' ? (
                    <View style={styles.groupBlock}>
                      <View style={styles.groupHeader}>
                        <ShieldCheck size={14} color={Colors.success} />
                        <Text style={styles.groupTitle}>
                          Admins ({peopleGroups.admins.length})
                        </Text>
                      </View>
                      <Text style={styles.groupHint}>A–Z by name</Text>
                      {peopleGroups.admins.map(renderPeopleCard)}
                    </View>
                  ) : null}

                  {peopleGroups.members.length > 0 &&
                  peopleFilter !== 'pending' &&
                  peopleFilter !== 'admins' ? (
                    <View style={styles.groupBlock}>
                      <View style={styles.groupHeader}>
                        <Users size={14} color={Colors.textSecondary} />
                        <Text style={styles.groupTitle}>
                          Members ({peopleGroups.members.length})
                        </Text>
                      </View>
                      <Text style={styles.groupHint}>Enabled accounts · A–Z by name</Text>
                      {peopleGroups.members.map(renderPeopleCard)}
                    </View>
                  ) : null}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(Colors: ColorPalette) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingBottom: 48 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  backBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.white },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.accent,
  },
  retryBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.white },

  pageTitle: {
    marginHorizontal: 16,
    marginTop: 12,
    fontSize: 26,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  pageSubtitle: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 14,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textSecondary,
  },
  notifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
  },
  notifyBannerText: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const },

  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  toolCard: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 14,
    gap: 4,
  },
  toolCardAlert: {
    borderColor: Colors.accent,
    backgroundColor: 'rgba(200, 149, 108, 0.08)',
  },
  toolTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text, marginTop: 6 },
  toolCount: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  toolHint: { fontSize: 11, color: Colors.textSecondary },
  toolLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 4,
    borderRadius: 12,
    backgroundColor: Colors.searchBar,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: Colors.card },
  segmentText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  segmentTextActive: { color: Colors.text },

  sectionHint: {
    marginHorizontal: 16,
    marginBottom: 10,
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  caughtUp: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 28,
    borderRadius: 16,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignItems: 'center',
    gap: 8,
  },
  caughtUpTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  caughtUpDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },

  requestCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderLeftWidth: 4,
    overflow: 'hidden',
  },
  requestHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  requestAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(200, 149, 108, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestInfo: { flex: 1 },
  requestName: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  requestEmail: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, alignItems: 'center' },
  metaText: { fontSize: 11, color: Colors.textLight },
  pillOk: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  pillOkText: { fontSize: 10, color: Colors.success, fontWeight: '600' as const },
  pillWarn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  pillWarnText: { fontSize: 10, color: Colors.danger, fontWeight: '600' as const },
  requestActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  denyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(196, 92, 74, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(196, 92, 74, 0.2)',
  },
  denyBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.danger },
  approveBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.success,
  },
  approveBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.white },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text, padding: 0 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  filterChipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  filterChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.white },
  matchCount: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  groupBlock: { marginBottom: 8 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 2,
  },
  groupTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  groupHint: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: 11,
    color: Colors.textLight,
  },

  peopleCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  peopleCardSelf: { borderColor: Colors.accent, borderWidth: 1.5 },
  peopleHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  peopleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peopleIconAdmin: { backgroundColor: 'rgba(74, 124, 89, 0.12)' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  peopleName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, flexShrink: 1 },
  peopleEmail: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  youBadge: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  youBadgeText: { fontSize: 10, fontWeight: '700' as const, color: Colors.white },
  pendingMini: {
    backgroundColor: 'rgba(200, 149, 108, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  pendingMiniText: { fontSize: 10, fontWeight: '700' as const, color: Colors.accent },
  claimText: { fontSize: 11, color: Colors.accent, marginTop: 4, fontWeight: '500' as const },
  togglesRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.divider },
  toggleItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toggleDivider: { width: 1, backgroundColor: Colors.divider },
  toggleLabel: { fontSize: 13, fontWeight: '500' as const, color: Colors.textSecondary },
  deleteBtn: { paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' },
  resetClaimBtn: {
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  resetClaimText: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const },
});
}
