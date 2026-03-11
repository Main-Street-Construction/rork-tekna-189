import React, { useState, useCallback } from 'react';
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
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface AdminUserRow {
  id: string;
  email: string | null;
  is_enabled: boolean;
  is_admin: boolean;
  created_at: string | null;
  email_confirmed: boolean;
}

export default function AdminScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAdmin, user } = useAuth();
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['adminUsersList'],
    queryFn: async (): Promise<AdminUserRow[]> => {
      console.log('[Admin] Fetching user list via RPC...');
      const { data, error } = await supabase.rpc('admin_list_users_with_email');
      if (!error && data) {
        const rows = data as AdminUserRow[];
        console.log('[Admin] Loaded', rows.length, 'users via RPC (with email)');
        return rows;
      }
      console.warn('[Admin] RPC admin_list_users_with_email failed:', error?.message, '— trying fallback');
      const { data: fallback, error: fbErr } = await supabase.rpc('admin_list_users');
      if (!fbErr && fallback) {
        const rows = (fallback as Array<{ id: string; is_enabled: boolean; is_admin: boolean; created_at: string | null }>).map((r) => ({
          ...r,
          email: null,
          email_confirmed: false,
        }));
        console.log('[Admin] Loaded', rows.length, 'users via fallback RPC');
        return rows;
      }
      console.error('[Admin] All RPCs failed:', fbErr?.message);
      throw new Error(fbErr?.message ?? 'Failed to load users');
    },
    enabled: isAdmin,
  });

  const updateUserMutation = useMutation({
    mutationFn: async (params: {
      targetUserId: string;
      setIsEnabled?: boolean;
      setIsAdmin?: boolean;
    }) => {
      console.log('[Admin] Updating user:', params.targetUserId, params);
      const { data, error } = await supabase.rpc('admin_update_user', {
        target_user_id: params.targetUserId,
        set_is_enabled: params.setIsEnabled ?? null,
        set_is_admin: params.setIsAdmin ?? null,
      });

      if (error) throw new Error(error.message);

      const result = data as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error ?? 'Update failed');
      }
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
    onSettled: () => {
      setUpdatingUserId(null);
    },
  });

  const handleToggleEnabled = useCallback((targetUser: AdminUserRow) => {
    const newValue = !targetUser.is_enabled;
    const action = newValue ? 'enable' : 'disable';
    const displayName = targetUser.email ?? targetUser.id.slice(0, 8) + '...';

    Alert.alert(
      `${newValue ? 'Enable' : 'Disable'} User`,
      `Are you sure you want to ${action} ${displayName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: newValue ? 'Enable' : 'Disable',
          style: newValue ? 'default' : 'destructive',
          onPress: () => {
            setUpdatingUserId(targetUser.id);
            updateUserMutation.mutate({
              targetUserId: targetUser.id,
              setIsEnabled: newValue,
            });
          },
        },
      ]
    );
  }, [updateUserMutation]);

  const handleToggleAdmin = useCallback((targetUser: AdminUserRow) => {
    if (targetUser.id === user?.id) {
      Alert.alert('Cannot Change', 'You cannot revoke your own admin status.');
      return;
    }

    const newValue = !targetUser.is_admin;
    const action = newValue ? 'grant admin to' : 'revoke admin from';
    const displayName = targetUser.email ?? targetUser.id.slice(0, 8) + '...';

    Alert.alert(
      `${newValue ? 'Grant' : 'Revoke'} Admin`,
      `Are you sure you want to ${action} ${displayName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: newValue ? 'Grant' : 'Revoke',
          style: newValue ? 'default' : 'destructive',
          onPress: () => {
            setUpdatingUserId(targetUser.id);
            updateUserMutation.mutate({
              targetUserId: targetUser.id,
              setIsAdmin: newValue,
            });
          },
        },
      ]
    );
  }, [updateUserMutation, user?.id]);

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

  const users = usersQuery.data ?? [];
  const enabledCount = users.filter((u) => u.is_enabled).length;

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

      {usersQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading users...</Text>
        </View>
      ) : usersQuery.error ? (
        <View style={styles.emptyContainer}>
          <AlertTriangle size={48} color={Colors.danger} />
          <Text style={styles.emptyTitle}>Error Loading Users</Text>
          <Text style={styles.emptyDesc}>
            {usersQuery.error instanceof Error ? usersQuery.error.message : 'Unknown error'}
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => void usersQuery.refetch()}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={usersQuery.isRefetching}
              onRefresh={() => void usersQuery.refetch()}
              tintColor={Colors.accent}
            />
          }
        >
          <View style={styles.statsRow}>
            <Users size={16} color={Colors.accent} />
            <Text style={styles.statsText}>
              {users.length} user{users.length !== 1 ? 's' : ''} registered
            </Text>
            <View style={styles.statsDot} />
            <Text style={styles.statsTextSecondary}>
              {enabledCount} enabled
            </Text>
          </View>

          {users.map((u) => {
            const isSelf = u.id === user?.id;
            const isUpdating = updatingUserId === u.id;
            const displayEmail = u.email ?? 'No email available';
            const createdDate = u.created_at
              ? new Date(u.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
              : null;

            return (
              <View key={u.id} style={[styles.userCard, isSelf && styles.userCardSelf]}>
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
                      <Text style={styles.userEmail} numberOfLines={1}>
                        {displayEmail}
                      </Text>
                      {isSelf && (
                        <View style={styles.selfBadge}>
                          <Text style={styles.selfBadgeText}>You</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.userMeta}>
                      {createdDate && (
                        <Text style={styles.userDate}>Joined {createdDate}</Text>
                      )}
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
                  </View>
                </View>

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
                        testID={`toggle-enabled-${u.id}`}
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
                        testID={`toggle-admin-${u.id}`}
                      />
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 4,
  },
  emptyDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.white,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.accent,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.white,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    gap: 8,
  },
  statsText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  statsDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.textLight,
  },
  statsTextSecondary: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  userCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  userCardSelf: {
    borderColor: Colors.accent,
    borderWidth: 1.5,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  userIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userIconAdmin: {
    backgroundColor: 'rgba(74, 124, 89, 0.1)',
  },
  userInfo: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userEmail: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    flexShrink: 1,
  },
  selfBadge: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  selfBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.white,
  },
  userMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  userDate: {
    fontSize: 11,
    color: Colors.textLight,
  },
  confirmedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  confirmedText: {
    fontSize: 10,
    color: Colors.success,
    fontWeight: '500' as const,
  },
  unconfirmedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  unconfirmedText: {
    fontSize: 10,
    color: Colors.danger,
    fontWeight: '500' as const,
  },
  togglesRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  toggleItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  toggleDivider: {
    width: 1,
    backgroundColor: Colors.divider,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  updatingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingVertical: 14,
    gap: 8,
  },
  updatingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
});
