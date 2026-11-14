import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { router as expoRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import {
  setProfileFullName,
  notifyAdminsAccessRequest,
  flushPendingAccessNotifications,
  deleteMyAccount,
} from '@/lib/supabase-rpc';
import {
  registerAdminPushNotifications,
  unregisterAdminPushNotifications,
  startAdminPushAutoReregister,
} from '@/lib/push-notifications';
import {
  getPasswordResetRedirectUrl,
  handleAuthDeepLink,
  isPasswordRecoveryUrl,
} from '@/lib/auth-deeplink';
import * as Linking from 'expo-linking';
import type { Session, User } from '@supabase/supabase-js';

const PENDING_FULL_NAME_KEY = 'pending_signup_full_name';
const AUTH_PROFILE_SNAPSHOT_KEY = 'auth_profile_snapshot_v1';
/** How often to re-verify enablement with the server (security). Not on every open. */
const PROFILE_SECURITY_TTL_MS = 24 * 60 * 60 * 1000;
/** Tick while app is open to notice TTL expiry without waiting for next cold start. */
const PROFILE_SECURITY_TICK_MS = 60 * 60 * 1000;

export interface UserProfileRow {
  id: string;
  is_enabled: boolean;
  is_admin: boolean;
  full_name: string | null;
  claimed_gedcom_id: string | null;
  claimed_at: string | null;
}

type ProfileSnapshot = {
  userId: string;
  profile: UserProfileRow;
  verifiedAt: number;
};

const PROFILE_COLUMNS = 'id, is_enabled, is_admin, full_name, claimed_gedcom_id, claimed_at';

async function loadProfileSnapshot(userId: string): Promise<ProfileSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_PROFILE_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileSnapshot;
    if (!parsed?.userId || parsed.userId !== userId || !parsed.profile) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveProfileSnapshot(userId: string, profile: UserProfileRow): Promise<number> {
  const verifiedAt = Date.now();
  const payload: ProfileSnapshot = { userId, profile, verifiedAt };
  try {
    await AsyncStorage.setItem(AUTH_PROFILE_SNAPSHOT_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('[Auth] Failed to persist profile snapshot:', e);
  }
  return verifiedAt;
}

async function clearProfileSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AUTH_PROFILE_SNAPSHOT_KEY);
  } catch {
    // best-effort
  }
}

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
      // Don't fabricate "unverified / unclaimed" — that wiped features on transient insert errors.
      return null;
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
    // Keep caller on previous profileRow rather than faking disabled + no claim.
    return null;
  }
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [profileRow, setProfileRow] = useState<UserProfileRow | null>(null);
  const [profileVerifiedAt, setProfileVerifiedAt] = useState<number>(0);
  const [profileHydrated, setProfileHydrated] = useState<boolean>(false);
  /** Gate live profile fetches: only when no snapshot, TTL expired, login, or manual refresh. */
  const [allowProfileFetch, setAllowProfileFetch] = useState<boolean>(false);
  const securityCheckInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (cancelled) return;

        if (s?.user?.id) {
          const snap = await loadProfileSnapshot(s.user.id);
          if (!cancelled && snap) {
            setProfileRow(snap.profile);
            setProfileVerifiedAt(snap.verifiedAt);
            const stale = Date.now() - snap.verifiedAt >= PROFILE_SECURITY_TTL_MS;
            // Fresh snapshot → skip network on this open. Stale → schedule security check.
            setAllowProfileFetch(stale);
          } else if (!cancelled) {
            // First time / cleared cache: need a live profile read.
            setAllowProfileFetch(true);
          }
        }
        if (!cancelled) {
          setSession(s);
          setProfileHydrated(true);
          setSessionLoading(false);
        }
      } catch {
        if (!cancelled) {
          setProfileHydrated(true);
          setSessionLoading(false);
        }
      }
    };

    void bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (!s) {
        setProfileRow(null);
        setProfileVerifiedAt(0);
        setAllowProfileFetch(false);
        void clearProfileSnapshot();
        void unregisterAdminPushNotifications();
        queryClient.removeQueries({ queryKey: ['authProfile'] });
      } else if (event === 'SIGNED_IN') {
        // Fresh login: verify with server. TOKEN_REFRESHED / INITIAL_SESSION do not ping.
        setAllowProfileFetch(true);
        void queryClient.invalidateQueries({ queryKey: ['authProfile'] });
      }
      if (event === 'PASSWORD_RECOVERY') {
        setTimeout(() => {
          try {
            expoRouter.replace('/update-password');
          } catch (e) {
            console.warn('[Auth] Failed to navigate to update-password:', e);
          }
        }, 100);
      }
    });

    const consumeAuthUrl = async (url: string | null) => {
      if (!url) return;
      const result = await handleAuthDeepLink(url);
      if (result.error) {
        console.warn('[Auth] Deep link session error:', result.error);
      }
      if (result.handled && (result.recovery || isPasswordRecoveryUrl(url))) {
        setTimeout(() => {
          try {
            expoRouter.replace('/update-password');
          } catch (e) {
            console.warn('[Auth] Failed to navigate to update-password:', e);
          }
        }, 50);
      }
    };

    void Linking.getInitialURL().then((url) => {
      void consumeAuthUrl(url);
    });
    const linkSub = Linking.addEventListener('url', ({ url }) => {
      void consumeAuthUrl(url);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, [queryClient]);

  const profileQuery = useQuery({
    queryKey: ['authProfile', session?.user?.id],
    queryFn: async (): Promise<UserProfileRow | null> => {
      if (!session?.user?.id) return null;
      const remote = await ensureProfileExists(session.user.id, session.user.email ?? undefined);
      if (remote) {
        const verifiedAt = await saveProfileSnapshot(session.user.id, remote);
        setProfileVerifiedAt(verifiedAt);
        // Successful verify — close the gate until the next TTL / login / manual refresh.
        setAllowProfileFetch(false);
        return remote;
      }
      // Network/transient failure: keep last known snapshot for offline use.
      const snap = await loadProfileSnapshot(session.user.id);
      setAllowProfileFetch(false);
      return snap?.profile ?? null;
    },
    enabled: !!session?.user?.id && profileHydrated && allowProfileFetch,
    staleTime: PROFILE_SECURITY_TTL_MS,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: 1,
    retryDelay: 1500,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    // Ignore null from failed fetches so we don't clobber a good cached profile.
    if (profileQuery.data) {
      setProfileRow(profileQuery.data);
    }
  }, [profileQuery.data]);

  const maybeSecurityRefresh = useCallback(() => {
    if (!session?.user?.id) return;
    if (securityCheckInFlight.current) return;
    const age = profileVerifiedAt > 0 ? Date.now() - profileVerifiedAt : Number.POSITIVE_INFINITY;
    if (age < PROFILE_SECURITY_TTL_MS) return;
    securityCheckInFlight.current = true;
    setAllowProfileFetch(true);
    void queryClient
      .invalidateQueries({ queryKey: ['authProfile', session.user.id] })
      .finally(() => {
        securityCheckInFlight.current = false;
      });
  }, [session?.user?.id, profileVerifiedAt, queryClient]);

  // Periodic + foreground security re-check (TTL), not a blocking ping on every open.
  useEffect(() => {
    if (!session?.user?.id || !profileHydrated) return;

    maybeSecurityRefresh();

    const interval = setInterval(() => {
      maybeSecurityRefresh();
    }, PROFILE_SECURITY_TICK_MS);

    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') maybeSecurityRefresh();
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [session?.user?.id, profileHydrated, maybeSecurityRefresh]);

  useEffect(() => {
    if (!profileRow?.is_admin || !session?.user?.id) return;
    const stopAuto = startAdminPushAutoReregister();
    void (async () => {
      try {
        await registerAdminPushNotifications();
      } catch (e) {
        console.warn('[Push] register failed:', e);
      }
      await flushPendingAccessNotifications();
    })();
    return stopAuto;
  }, [profileRow?.is_admin, session?.user?.id]);

  const signInMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) {
        const profile = await ensureProfileExists(data.user.id, data.user.email ?? email);
        if (profile) {
          const verifiedAt = await saveProfileSnapshot(data.user.id, profile);
          setProfileRow(profile);
          setProfileVerifiedAt(verifiedAt);
        }
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
        const profile = await ensureProfileExists(data.user.id, data.user.email ?? email);
        if (trimmedName) {
          await setProfileFullName(trimmedName);
        }
        if (profile) {
          const refreshed = await ensureProfileExists(data.user.id, data.user.email ?? email);
          const toSave = refreshed ?? profile;
          const verifiedAt = await saveProfileSnapshot(data.user.id, toSave);
          setProfileRow(toSave);
          setProfileVerifiedAt(verifiedAt);
        }
        await notifyAdminsAccessRequest(data.user.id);
      } else if (data.user) {
        // Email confirmation means there is no session yet, so the name lives
        // in user metadata until the notify function copies it onto the profile.
        await notifyAdminsAccessRequest(data.user.id);
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
      setProfileVerifiedAt(0);
      void clearProfileSnapshot();
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      await unregisterAdminPushNotifications();
      const result = await deleteMyAccount();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete account');
      }
      try {
        await AsyncStorage.multiRemove([
          PENDING_FULL_NAME_KEY,
          AUTH_PROFILE_SNAPSHOT_KEY,
          'user_profile',
          'identity_claimed',
        ]);
      } catch {
        // Local cleanup is best-effort after server delete succeeds
      }
      try {
        await supabase.auth.signOut();
      } catch {
        // Session may already be invalid after auth user delete
      }
    },
    onSuccess: () => {
      setSession(null);
      setProfileRow(null);
      setProfileVerifiedAt(0);
      queryClient.clear();
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

  const deleteAccount = useCallback(
    () => deleteAccountMutation.mutateAsync(),
    [deleteAccountMutation]
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
        : getPasswordResetRedirectUrl();
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
    // Manual / PendingApproval "Check Status" — force a live verify.
    setAllowProfileFetch(true);
    void queryClient.invalidateQueries({ queryKey: ['authProfile'] });
  }, [queryClient]);

  const user: User | null = session?.user ?? null;
  const isSignedIn = !!session;
  const isEnabled = profileRow?.is_enabled ?? false;
  const isAdmin = profileRow?.is_admin ?? false;
  // Don't block the app on a network profile check when we already have a snapshot.
  const profileLoading =
    !!session?.user?.id && !profileRow && (profileQuery.isLoading || !profileHydrated);
  const isProfileStale =
    isSignedIn &&
    !!profileRow &&
    profileVerifiedAt > 0 &&
    Date.now() - profileVerifiedAt >= PROFILE_SECURITY_TTL_MS;

  return useMemo(() => ({
    user,
    session,
    profileRow,
    isSignedIn,
    isEnabled,
    isAdmin,
    sessionLoading,
    profileLoading,
    isProfileStale,
    profileVerifiedAt,
    signIn,
    signUp,
    signOut,
    deleteAccount,
    resetPassword,
    resendConfirmation,
    refreshProfile,
    signInPending: signInMutation.isPending,
    signUpPending: signUpMutation.isPending,
    signOutPending: signOutMutation.isPending,
    deleteAccountPending: deleteAccountMutation.isPending,
    resetPasswordPending: resetPasswordMutation.isPending,
    resendConfirmationPending: resendConfirmationMutation.isPending,
    signInError: signInMutation.error,
    signUpError: signUpMutation.error,
    resetPasswordError: resetPasswordMutation.error,
  }), [
    user, session, profileRow, isSignedIn, isEnabled, isAdmin,
    sessionLoading, profileLoading, isProfileStale, profileVerifiedAt,
    signIn, signUp, signOut, deleteAccount, resetPassword, resendConfirmation, refreshProfile,
    signInMutation.isPending, signUpMutation.isPending, signOutMutation.isPending,
    deleteAccountMutation.isPending,
    resetPasswordMutation.isPending, resendConfirmationMutation.isPending,
    signInMutation.error, signUpMutation.error, resetPasswordMutation.error,
  ]);
});
