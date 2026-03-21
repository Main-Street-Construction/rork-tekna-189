import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { UserProfile } from '@/types/genealogy';
import { saveProfileToSupabase, loadProfileFromSupabase } from '@/lib/supabase-db';
import { useAuth } from '@/contexts/AuthContext';

const PROFILE_KEY = 'user_profile';
const CLAIMED_KEY = 'identity_claimed';
const { user } = useAuth();
export const [ProfileProvider, useProfile] = createContextHook(() => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
const { user } = useAuth();
  const loadQuery = useQuery({
    queryKey: ['userProfile'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(PROFILE_KEY);
      if (stored) {
        return JSON.parse(stored) as UserProfile;
      }
      return null;
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (loadQuery.data !== undefined) {
      setProfile(loadQuery.data);
    }
  }, [loadQuery.data]);

  const [isClaimed, setIsClaimed] = useState<boolean>(false);

  const claimedQuery = useQuery({
    queryKey: ['identityClaimed'],
    queryFn: async () => {
      const claimed = await AsyncStorage.getItem(CLAIMED_KEY);
      return claimed === 'true';
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
  if (!user?.id) return;
  loadProfileFromSupabase(user.id).then((remote) => {
    if (!remote) return;
    if (remote.root_person_id && remote.is_claimed) {
      const restored: UserProfile = {
        id: user.id,
        displayName: remote.display_name ?? '',
        email: remote.email ?? undefined,
        avatarInitials: remote.avatar_initials ?? undefined,
        rootPersonId: remote.root_person_id,
        rootPersonName: remote.root_person_name ?? undefined,
        createdAt: Date.now(),
      };
      setProfile(restored);
      setIsClaimed(true);
      void AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(restored));
      void AsyncStorage.setItem(CLAIMED_KEY, 'true');
    }
  });
}, [user?.id]);

  const saveMutation = useMutation({
    mutationFn: async (newProfile: UserProfile) => {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(newProfile));
      return newProfile;
    },
    onSuccess: (data) => {
      setProfile(data);
    },
  });

 const saveProfile = useCallback(
  (updates: Partial<UserProfile>) => {
    const existing = profile ?? {
      id: Date.now().toString(),
      displayName: '',
      createdAt: Date.now(),
    };
    const updated: UserProfile = { ...existing, ...updates };
    const initials = updated.displayName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    updated.avatarInitials = initials;
    saveMutation.mutate(updated);
    if (user?.id) {
      void saveProfileToSupabase(user.id, {
        display_name: updated.displayName,
        email: updated.email,
        avatar_initials: initials,
        root_person_id: updated.rootPersonId,
        root_person_name: updated.rootPersonName,
        is_claimed: isClaimed,
      });
    }
  },
  [profile, saveMutation, user, isClaimed]
);

  const resetClaim = useCallback(async () => {
    await AsyncStorage.removeItem(CLAIMED_KEY);
    setIsClaimed(false);
    const existing = profile;
    if (existing) {
      const updated: UserProfile = {
        ...existing,
        rootPersonId: undefined,
        rootPersonName: undefined,
      };
      saveMutation.mutate(updated);
    }

  }, [profile, saveMutation]);

  const claimIdentity = useCallback(
  async (personId: string, personName: string) => {
    const existing = profile ?? {
      id: Date.now().toString(),
      displayName: personName,
      createdAt: Date.now(),
    };
    const updated: UserProfile = {
      ...existing,
      displayName: personName,
      rootPersonId: personId,
      rootPersonName: personName,
    };
    const initials = updated.displayName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    updated.avatarInitials = initials;
    await AsyncStorage.setItem(CLAIMED_KEY, 'true');
    setIsClaimed(true);
    saveMutation.mutate(updated);
    if (user?.id) {
      void saveProfileToSupabase(user.id, {
        display_name: updated.displayName,
        email: updated.email,
        avatar_initials: initials,
        root_person_id: personId,
        root_person_name: personName,
        is_claimed: true,
      });
    }
  },
  [profile, saveMutation, user]
);

  const hasProfile = profile !== null && profile.displayName.length > 0;
  const hasClaimed = isClaimed && profile?.rootPersonId != null;

  return useMemo(() => ({
    profile,
    hasProfile,
    hasClaimed,
    isClaimed,
    saveProfile,
    claimIdentity,
    resetClaim,
    isSaving: saveMutation.isPending,
  }), [
    profile, hasProfile, hasClaimed, isClaimed,
    saveProfile, claimIdentity, resetClaim, saveMutation.isPending,
  ]);
});
