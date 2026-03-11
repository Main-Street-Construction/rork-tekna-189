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
      console.log('[Auth] Fetching profile row for', session.user.id);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, is_enabled, is_admin, created_at')
        .eq('id', session.user.id)
        .single();

      if (error) {
        console.warn('[Auth] Profile fetch error:', error.message);
        return null;
      }
      console.log('[Auth] Profile loaded:', JSON.stringify(data));
      return data as UserProfileRow;
    },
    enabled: !!session?.user?.id,
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
      if (error) throw error;
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
    refreshProfile,
    signInPending: signInMutation.isPending,
    signUpPending: signUpMutation.isPending,
    signOutPending: signOutMutation.isPending,
    signInError: signInMutation.error,
    signUpError: signUpMutation.error,
  }), [
    user, session, profileRow, isSignedIn, isEnabled, isAdmin,
    sessionLoading, profileQuery.isLoading,
    signIn, signUp, signOut, refreshProfile,
    signInMutation.isPending, signUpMutation.isPending, signOutMutation.isPending,
    signInMutation.error, signUpMutation.error,
  ]);
});
