import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { UserProfile } from '@/types/genealogy';

const PROFILE_KEY = 'user_profile';
const CLAIMED_KEY = 'identity_claimed';

export const [ProfileProvider, useProfile] = createContextHook(() => {
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const loadQuery = useQuery({
    queryKey: ['userProfile'],
    queryFn: async () => {

      const stored = await AsyncStorage.getItem(PROFILE_KEY);
      if (stored) {
        return JSON.parse(stored) as UserProfile;
      }
      return null;
    },
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
  });

  useEffect(() => {
    if (claimedQuery.data !== undefined) {
      setIsClaimed(claimedQuery.data);
    }
  }, [claimedQuery.data]);

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
    },
    [profile, saveMutation]
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
    },
    [profile, saveMutation]
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
