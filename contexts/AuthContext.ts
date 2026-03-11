import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { supabase } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';

export interface UserProfileRow {
  id: string;
  email: string | null;
  is_enabled: boolean;
  is_admin: boolean;
  created_at: string;
}

const ADMIN_EMAIL = 'charlemartel6@gmail.com';

async function ensureProfileExists(userId: string, email: string | undefined): Promise<UserProfileRow | null> {
  console.log('[Auth] Ensuring profile exists for', userId, email);
  const { data: existing, error: fetchErr } = await supabase
    .from('profiles')
    .select('id, email, is_enabled, is_admin, created_at')
    .eq('id', userId)
    .single();

  if (existing && !fetchErr) {
    console.log('[Auth] Profile already exists:', JSON.stringify(existing));
    if (email === ADMIN_EMAIL && (!existing.is_admin || !existing.is_enabled)) {
      console.log('[Auth] Auto-promoting admin email:', email);
      const { data: updated, error: updateErr } = await supabase
        .from('profiles')
        .update({ is_admin: true, is_enabled: true })
        .eq('id', userId)
        .select('id, email, is_enabled, is_admin, created_at')
        .single();
      if (updated && !updateErr) return updated as UserProfileRow;
      console.warn('[Auth] Admin auto-promote failed:', updateErr?.message);
    }
    return existing as UserProfileRow;
  }

  console.log('[Auth] Profile not found, creating fallback profile for', userId);
  const isAdminUser = email === ADMIN_EMAIL;
  const { data: created, error: insertErr } = await supabase
    .from('profiles')
    .insert({
      id: userId,
      email: email ?? null,
      is_enabled: isAdminUser,
      is_admin: isAdminUser,
    })
    .select('id, email, is_enabled, is_admin, created_at')
    .single();

  if (insertErr) {
    console.warn('[Auth] Fallback profile insert failed:', insertErr.message);
    if (insertErr.message.includes('duplicate') || insertErr.code === '23505') {
      const { data: retry } = await supabase
        .from('profiles')
        .select('id, email, is_enabled, is_admin, created_at')
        .eq('id', userId)
        .single();
      return (retry as UserProfileRow) ?? null;
    }
    return null;
  }

  console.log('[Auth] Fallback profile created:', JSON.stringify(created));
  return created as UserProfileRow;
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [profileRow, setProfileRow] = useState<UserProfileRow | null>(null);

  useEffect(() => {
    console.log('[Auth] Initializing session...');
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      console.log('[Auth] Initial session:', s ? s.user.email : 'none');
      setSession(s);
      setSessionLoading(false);
    }).catch((e) => {
      console.warn('[Auth] Failed to get initial session:', e);
      setSessionLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      console.log('[Auth] Auth state changed:', _event, s ? s.user.email : 'none');
      setSession(s);
      if (!s) {
        setProfileRow(null);
        queryClient.removeQueries({ queryKey: ['authProfile'] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['authProfile'] });
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
      console.log('[Auth] Fetching profile for', session.user.id, session.user.email);
      return ensureProfileExists(session.user.id, session.user.email ?? undefined);
    },
    enabled: !!session?.user?.id,
    retry: 2,
    retryDelay: 1000,
  });

  useEffect(() => {
    if (profileQuery.data !== undefined) {
      setProfileRow(profileQuery.data);
    }
  }, [profileQuery.data]);

  const signInMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      console.log('[Auth] Signing in:', email);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
  });

  const signUpMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      console.log('[Auth] Signing up:', email);
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        console.warn('[Auth] Signup error:', error.message);
        if (error.message.includes('Database error saving new user')) {
          throw new Error(
            'Signup failed due to a database configuration issue. Please ask the admin to check that the signup trigger has correct permissions. SQL fix: GRANT USAGE ON SCHEMA public TO supabase_auth_admin; GRANT INSERT ON public.profiles TO supabase_auth_admin;'
          );
        }
        throw error;
      }
      if (data.user) {
        console.log('[Auth] Signup successful, ensuring profile exists...');
        await ensureProfileExists(data.user.id, email);
      }
      return data;
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      console.log('[Auth] Signing out');
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
    (email: string, password: string) => signUpMutation.mutateAsync({ email, password }),
    [signUpMutation]
  );

  const signOut = useCallback(
    () => signOutMutation.mutateAsync(),
    [signOutMutation]
  );

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      console.log('[Auth] Sending password reset to:', email);
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
    },
  });

  const resetPassword = useCallback(
    (email: string) => resetPasswordMutation.mutateAsync({ email }),
    [resetPasswordMutation]
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
    refreshProfile,
    signInPending: signInMutation.isPending,
    signUpPending: signUpMutation.isPending,
    signOutPending: signOutMutation.isPending,
    resetPasswordPending: resetPasswordMutation.isPending,
    signInError: signInMutation.error,
    signUpError: signUpMutation.error,
    resetPasswordError: resetPasswordMutation.error,
  }), [
    user, session, profileRow, isSignedIn, isEnabled, isAdmin,
    sessionLoading, profileQuery.isLoading,
    signIn, signUp, signOut, resetPassword, refreshProfile,
    signInMutation.isPending, signUpMutation.isPending, signOutMutation.isPending,
    resetPasswordMutation.isPending,
    signInMutation.error, signUpMutation.error, resetPasswordMutation.error,
  ]);
});
