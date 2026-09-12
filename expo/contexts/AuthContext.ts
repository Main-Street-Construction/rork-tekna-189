import { useState, useEffect, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import * as Linking from 'expo-linking';
import { router as expoRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import {
  setProfileFullName,
  notifyAdminsAccessRequest,
} from '@/lib/supabase-rpc';
import {
  registerAdminPushNotifications,
  unregisterAdminPushNotifications,
} from '@/lib/push-notifications';
import type { Session, User } from '@supabase/supabase-js';

const PENDING_FULL_NAME_KEY = 'pending_signup_full_name';

export interface UserProfileRow {
  id: string;
  is_enabled: boolean;
  is_admin: boolean;
  full_name: string | null;
  claimed_gedcom_id: string | null;
  claimed_at: string | null;
}

const PROFILE_COLUMNS = 'id, is_enabled, is_admin, full_name, claimed_gedcom_id, claimed_at';

async function applyPendingFullName(userId: string, email: string): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_FULL_NAME_KEY);
    if (!stored) return;

    const parsed = JSON.parse(stored) as { email: string; fullName: string };
    if (parsed.email.toLowerCase() !== email.toLowerCase()) return;

    const result = await setProfileFullName(parsed.fullName);
    if (result.success) {
      await AsyncStorage.removeItem(PENDING_FULL_NAME_KEY);
      void notifyAdminsAccessRequest(result.userId ?? userId);
    }
  } catch (e) {
    console.warn('[Auth] applyPendingFullName failed:', e);
  }
}

async function ensureProfileExists(userId: string, email?: string): Promise<UserProfileRow | null> {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .single();

    if (existing && !fetchErr) {
      if (email && !existing.full_name) {
        await applyPendingFullName(userId, email);
        const { data: refreshed } = await supabase
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .eq('id', userId)
          .single();
        return (refreshed as UserProfileRow) ?? (existing as UserProfileRow);
      }
      return existing as UserProfileRow;
    }

    const { data: created, error: insertErr } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        is_enabled: false,
        is_admin: false,
      })
      .select(PROFILE_COLUMNS)
      .single();

    if (insertErr) {
      if (insertErr.message.includes('duplicate') || insertErr.code === '23505') {
        const { data: retry } = await supabase
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .eq('id', userId)
          .single();
        return (retry as UserProfileRow) ?? null;
      }
      return {
        id: userId,
        is_enabled: false,
        is_admin: false,
        full_name: null,
        claimed_gedcom_id: null,
        claimed_at: null,
      };
    }

    if (email) {
      await applyPendingFullName(userId, email);
      const { data: refreshed } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .single();
      return (refreshed as UserProfileRow) ?? (created as UserProfileRow);
    }

    return created as UserProfileRow;
  } catch {
    return {
      id: userId,
      is_enabled: false,
      is_admin: false,
      full_name: null,
      claimed_gedcom_id: null,
      claimed_at: null,
    };
  }
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [profileRow, setProfileRow] = useState<UserProfileRow | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setSessionLoading(false);
    }).catch(() => {
      setSessionLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (!s) {
        setProfileRow(null);
        void unregisterAdminPushNotifications();
        queryClient.removeQueries({ queryKey: ['authProfile'] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['authProfile'] });
      }
      if (event === 'PASSWORD_RECOVERY') {
        setTimeout(() => {
          try {
            expoRouter.push('/update-password');
          } catch (e) {
            console.warn('[Auth] Failed to navigate to update-password:', e);
          }
        }, 100);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [queryClient]);

  const profileQuery = useQuery({
    queryKey: ['authProfile', session?.user?.id],
    queryFn: async (): Promise<UserProfileRow | null> => {
      if (!session?.user?.id) return null;
      return ensureProfileExists(session.user.id, session.user.email ?? undefined);
    },
    enabled: !!session?.user?.id,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    retryDelay: 1000,
  });

  useEffect(() => {
    if (profileQuery.data !== undefined) {
      setProfileRow(profileQuery.data);
    }
  }, [profileQuery.data]);

  useEffect(() => {
    if (profileRow?.is_admin && session) {
      void registerAdminPushNotifications();
    }
  }, [profileRow?.is_admin, session]);

  const signInMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) {
        await ensureProfileExists(data.user.id, data.user.email ?? email);
      }
      return data;
    },
  });

  const signUpMutation = useMutation({
    mutationFn: async ({
      email,
      password,
      fullName,
    }: {
      email: string;
      password: string;
      fullName?: string;
    }) => {
      const trimmedName = fullName?.trim() ?? '';
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: trimmedName
          ? {
              data: {
                full_name: trimmedName,
              },
            }
          : undefined,
      });
      if (error) {
        if (error.message.includes('Database error saving new user')) {
          throw new Error(
            'Signup failed due to a database configuration issue. Please contact the administrator.'
          );
        }
        throw error;
      }
      const needsEmailConfirmation = !data.session && !!data.user;
      if (data.session && data.user) {
        await ensureProfileExists(data.user.id, data.user.email ?? email);
        if (trimmedName) {
          const nameResult = await setProfileFullName(trimmedName);
          if (nameResult.success) {
            void notifyAdminsAccessRequest(nameResult.userId ?? data.user.id);
          } else {
            void notifyAdminsAccessRequest(data.user.id);
          }
        }
      } else if (data.user && trimmedName) {
        // Email confirmation required — name is in user_metadata + DB trigger;
        // still notify admins immediately so the request is not lost.
        void notifyAdminsAccessRequest(data.user.id);
      }
      return { ...data, needsEmailConfirmation };
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      await unregisterAdminPushNotifications();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      setSession(null);
      setProfileRow(null);
    },
  });

  const signIn = useCallback(
    (email: string, password: string) => signInMutation.mutateAsync({ email, password }),
    [signInMutation]
  );

  const signUp = useCallback(
    (email: string, password: string, fullName?: string) =>
      signUpMutation.mutateAsync({ email, password, fullName }),
    [signUpMutation]
  );

  const signOut = useCallback(
    () => signOutMutation.mutateAsync(),
    [signOutMutation]
  );

  const resendConfirmationMutation = useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      const appUrl = Platform.OS === 'web'
        ? `${typeof window !== 'undefined' ? window.location.origin : ''}/update-password`
        : Linking.createURL('/update-password');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: appUrl,
      });
      if (error) throw error;
    },
  });

  const resetPassword = useCallback(
    (email: string) => resetPasswordMutation.mutateAsync({ email }),
    [resetPasswordMutation]
  );

  const resendConfirmation = useCallback(
    (email: string) => resendConfirmationMutation.mutateAsync({ email }),
    [resendConfirmationMutation]
  );

  const refreshProfile = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['authProfile'] });
  }, [queryClient]);

  const user: User | null = session?.user ?? null;
  const isSignedIn = !!session;
  const isEnabled = profileRow?.is_enabled ?? false;
  const isAdmin = profileRow?.is_admin ?? false;

  return useMemo(() => ({
    user,
    session,
    profileRow,
    isSignedIn,
    isEnabled,
    isAdmin,
    sessionLoading,
    profileLoading: profileQuery.isLoading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    resendConfirmation,
    refreshProfile,
    signInPending: signInMutation.isPending,
    signUpPending: signUpMutation.isPending,
    signOutPending: signOutMutation.isPending,
    resetPasswordPending: resetPasswordMutation.isPending,
    resendConfirmationPending: resendConfirmationMutation.isPending,
    signInError: signInMutation.error,
    signUpError: signUpMutation.error,
    resetPasswordError: resetPasswordMutation.error,
  }), [
    user, session, profileRow, isSignedIn, isEnabled, isAdmin,
    sessionLoading, profileQuery.isLoading,
    signIn, signUp, signOut, resetPassword, resendConfirmation, refreshProfile,
    signInMutation.isPending, signUpMutation.isPending, signOutMutation.isPending,
    resetPasswordMutation.isPending, resendConfirmationMutation.isPending,
    signInMutation.error, signUpMutation.error, resetPasswordMutation.error,
  ]);
});
