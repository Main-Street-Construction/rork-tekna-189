import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Switch,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
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
  Database,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  adminListUsersWithEmail,
  adminResetUserClaim,
  type AdminUserRow,
} from '@/lib/supabase-rpc';

export default function AdminScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAdmin, user } = useAuth();
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

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
  });

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
      const { data, error } = await supabase.rpc('admin_delete_user', {
        target_user_id: targetUserId,
      });
      if (error) throw new Error(error.message);
      const result = data as { success: boolean; error?: string };
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
  const pendingUsers = useMemo(
    () => users.filter((u) => !u.is_enabled).sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    }),
    [users]
  );
  const enabledCount = users.filter((u) => u.is_enabled).length;

  const displayName = (u: AdminUserRow) => {
    if (u.full_name?.trim()) return u.full_name.trim();
    return u.email ?? u.id.slice(0, 8) + '...';
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleToggleEnabled = useCallback((targetUser: AdminUserRow) => {
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
  }, [updateUserMutation]);

  const handleQuickEnable = useCallback((targetUser: AdminUserRow) => {
    setUpdatingUserId(targetUser.id);
    updateUserMutation.mutate({ targetUserId: targetUser.id, setIsEnabled: true });
  }, [updateUserMutation]);

  const handleDeleteUser = useCallback((targetUser: AdminUserRow) => {
    if (targetUser.id === user?.id) {
      Alert.alert('Cannot Delete', 'You cannot delete your own account.');
      return;
    }
    Alert.alert(
      'Delete User',
      `Permanently delete ${displayName(targetUser)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setUpdatingUserId(targetUser.id);
            deleteUserMutation.mutate(targetUser.id);
          },
        },
      ]
    );
  }, [deleteUserMutation, user?.id]);

  const handleToggleAdmin = useCallback((targetUser: AdminUserRow) => {
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
  }, [updateUserMutation, user?.id]);

  const renderUserCard = (u: AdminUserRow, showQuickEnable = false) => {
    const isSelf = u.id === user?.id;
    const isUpdating = updatingUserId === u.id;
    const primaryName = displayName(u);
    const createdDate = formatDate(u.created_at);
    const lastSignIn = formatDate(u.last_sign_in_at);

    return (
      <View key={u.id} style={[styles.userCard, isSelf && styles.userCardSelf, showQuickEnable && styles.userCardPending]}>
        <View style={styles.userHeader}>
          <View style={[styles.userIcon, u.is_admin && styles.userIconAdmin]}>
            {u.is_admin ? (
              <ShieldCheck size={18} color={Colors.success} />
            ) : (
              <Mail size={18} color={Colors.textSecondary} />
            )}
          </View>
          <View style={styles.userInfo}>
            <View style={styles.userNameRow}>
              <Text style={styles.userEmail} numberOfLines={1}>{primaryName}</Text>
              {isSelf && (
                <View style={styles.selfBadge}>
                  <Text style={styles.selfBadgeText}>You</Text>
                </View>
              )}
            </View>
            {u.email && u.full_name?.trim() ? (
              <Text style={styles.userSecondaryEmail} numberOfLines={1}>{u.email}</Text>
            ) : null}
            <View style={styles.userMeta}>
              {createdDate && <Text style={styles.userDate}>Joined {createdDate}</Text>}
              {lastSignIn && <Text style={styles.userDate}>Last sign-in {lastSignIn}</Text>}
              {u.email_confirmed ? (
                <View style={styles.confirmedBadge}>
                  <CheckCircle size={10} color={Colors.success} />
                  <Text style={styles.confirmedText}>Confirmed</Text>
                </View>
              ) : (
                <View style={styles.unconfirmedBadge}>
                  <XCircle size={10} color={Colors.danger} />
                  <Text style={styles.unconfirmedText}>Unconfirmed</Text>
                </View>
              )}
            </View>
            {u.claimed_gedcom_id ? (
              <Text style={styles.claimText} numberOfLines={1}>
                Claimed: {u.claimed_person_name ?? u.claimed_gedcom_id}
              </Text>
            ) : null}
          </View>
        </View>

        {showQuickEnable && !u.is_enabled && (
          <TouchableOpacity
            style={styles.quickEnableBtn}
            onPress={() => handleQuickEnable(u)}
            disabled={isUpdating}
            activeOpacity={0.8}
          >
            <UserCheck size={16} color={Colors.white} />
            <Text style={styles.quickEnableText}>Enable Access</Text>
          </TouchableOpacity>
        )}

        {isUpdating ? (
          <View style={styles.updatingOverlay}>
            <ActivityIndicator size="small" color={Colors.accent} />
            <Text style={styles.updatingText}>Updating...</Text>
          </View>
        ) : (
          <View style={styles.togglesRow}>
            <View style={styles.toggleItem}>
              <Text style={styles.toggleLabel}>Enabled</Text>
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
            {!isSelf && (
              <>
                <View style={styles.toggleDivider} />
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteUser(u)}>
                  <Trash2 size={16} color={Colors.danger} />
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {u.claimed_gedcom_id && !isSelf ? (
          <TouchableOpacity
            style={styles.resetClaimBtn}
            onPress={() => {
              Alert.alert('Reset Claim', `Clear identity claim for ${primaryName}?`, [
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
        <Stack.Screen options={{ title: 'Admin Panel' }} />
        <View style={styles.emptyContainer}>
          <ShieldOff size={48} color={Colors.textLight} />
          <Text style={styles.emptyTitle}>Access Denied</Text>
          <Text style={styles.emptyDesc}>You don't have admin privileges.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
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
          title: 'Admin Panel',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false,
        }}
      />

      <TouchableOpacity
        style={styles.dataConsoleLink}
        onPress={() => router.push('/admin/data')}
        activeOpacity={0.8}
      >
        <Database size={18} color={Colors.accent} />
        <Text style={styles.dataConsoleText}>Genealogy Data Console</Text>
      </TouchableOpacity>

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
          refreshControl={
            <RefreshControl refreshing={usersQuery.isRefetching} onRefresh={() => void usersQuery.refetch()} tintColor={Colors.accent} />
          }
        >
          <View style={styles.statsRow}>
            <Users size={16} color={Colors.accent} />
            <Text style={styles.statsText}>{users.length} users</Text>
            <View style={styles.statsDot} />
            <Text style={styles.statsTextSecondary}>{enabledCount} enabled</Text>
            <View style={styles.statsDot} />
            <Text style={styles.statsTextSecondary}>{pendingUsers.length} pending</Text>
          </View>

          {pendingUsers.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <Clock size={16} color={Colors.accent} />
                <Text style={styles.sectionTitle}>Pending Access ({pendingUsers.length})</Text>
              </View>
              {pendingUsers.map((u) => renderUserCard(u, true))}
            </>
          )}

          <View style={styles.sectionHeader}>
            <Users size={16} color={Colors.textSecondary} />
            <Text style={styles.sectionTitle}>All Users</Text>
          </View>
          {users.map((u) => renderUserCard(u))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  backBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary },
  backBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.white },
  retryBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.accent },
  retryBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.white },
  dataConsoleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  dataConsoleText: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 16, marginBottom: 8, gap: 8 },
  statsText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  statsDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.textLight },
  statsTextSecondary: { fontSize: 14, color: Colors.textSecondary },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  userCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  userCardSelf: { borderColor: Colors.accent, borderWidth: 1.5 },
  userCardPending: { borderColor: Colors.accent, borderLeftWidth: 4 },
  userHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  userIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.overlay, justifyContent: 'center', alignItems: 'center' },
  userIconAdmin: { backgroundColor: 'rgba(74, 124, 89, 0.1)' },
  userInfo: { flex: 1 },
  userNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userEmail: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, flexShrink: 1 },
  userSecondaryEmail: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  selfBadge: { backgroundColor: Colors.accent, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  selfBadgeText: { fontSize: 10, fontWeight: '700' as const, color: Colors.white },
  userMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 },
  userDate: { fontSize: 11, color: Colors.textLight },
  confirmedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  confirmedText: { fontSize: 10, color: Colors.success, fontWeight: '500' as const },
  unconfirmedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  unconfirmedText: { fontSize: 10, color: Colors.danger, fontWeight: '500' as const },
  claimText: { fontSize: 11, color: Colors.accent, marginTop: 4, fontWeight: '500' as const },
  quickEnableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 10,
    paddingVertical: 10,
    backgroundColor: Colors.success,
    borderRadius: 10,
  },
  quickEnableText: { fontSize: 14, fontWeight: '600' as const, color: Colors.white },
  togglesRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.divider },
  toggleItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  toggleDivider: { width: 1, backgroundColor: Colors.divider },
  toggleLabel: { fontSize: 13, fontWeight: '500' as const, color: Colors.textSecondary },
  updatingOverlay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderTopWidth: 1, borderTopColor: Colors.divider, paddingVertical: 14, gap: 8 },
  updatingText: { fontSize: 13, color: Colors.textSecondary },
  deleteBtn: { paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' },
  resetClaimBtn: { paddingVertical: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: Colors.divider },
  resetClaimText: { fontSize: 12, color: Colors.accent, fontWeight: '600' as const },
});
