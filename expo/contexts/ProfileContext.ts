import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { UserProfile } from '@/types/genealogy';
import { useAuth } from '@/contexts/AuthContext';
import {
  submitIdentityClaim,
  clearIdentityClaim,
  updateProfileDisplayName,
} from '@/lib/supabase-rpc';
import { supabase } from '@/lib/supabase';
import { fetchIndividualByGedcomId } from '@/lib/supabase-db';

const PROFILE_KEY = 'user_profile';
const CLAIMED_KEY = 'identity_claimed';

export const [ProfileProvider, useProfile] = createContextHook(() => {
  const { isSignedIn, profileRow } = useAuth();
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
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (loadQuery.data !== undefined) {
      setProfile(loadQuery.data);
    }
  }, [loadQuery.data]);

  const [isClaimed, setIsClaimed] = useState<boolean>(false);
  const [claimRepairNotice, setClaimRepairNotice] = useState<boolean>(false);
  const [isValidatingClaim, setIsValidatingClaim] = useState<boolean>(false);

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
    if (claimedQuery.data !== undefined) {
      setIsClaimed(claimedQuery.data);
    }
  }, [claimedQuery.data]);

  const syncClaimFromServer = useCallback(async () => {
    if (!isSignedIn || !profileRow?.claimed_gedcom_id) return;

    const gedcomId = profileRow.claimed_gedcom_id;
    const { data, error } = await supabase
      .from('individuals')
      .select('gedcom_id, first_name, last_name')
      .eq('gedcom_id', gedcomId)
      .limit(1);

    if (error) return;

    const row = data?.[0] as { first_name?: string; last_name?: string } | undefined;
    if (!row) {
      await clearIdentityClaim();
      await AsyncStorage.removeItem(CLAIMED_KEY);
      setIsClaimed(false);
      if (profile?.rootPersonId) {
        const updated: UserProfile = {
          ...profile,
          rootPersonId: undefined,
          rootPersonName: undefined,
        };
        await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
        setProfile(updated);
      }
      setClaimRepairNotice(true);
      return;
    }

    const personName = [row.first_name, row.last_name].filter(Boolean).join(' ');

    await AsyncStorage.setItem(CLAIMED_KEY, 'true');
    setIsClaimed(true);

    const existing = profile ?? {
      id: Date.now().toString(),
      displayName: personName,
      createdAt: Date.now(),
    };
    const updated: UserProfile = {
      ...existing,
      rootPersonId: gedcomId,
      rootPersonName: personName,
      displayName: personName,
    };
    const initials = updated.displayName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    updated.avatarInitials = initials;
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    setProfile(updated);
  }, [isSignedIn, profileRow?.claimed_gedcom_id, profile]);

  useEffect(() => {
    if (profileRow?.claimed_gedcom_id) {
      void syncClaimFromServer();
    }
  }, [profileRow?.claimed_gedcom_id, syncClaimFromServer]);

  useEffect(() => {
    if (!isSignedIn || profileRow?.claimed_gedcom_id) return;
    if (!profile?.rootPersonId || !isClaimed) return;

    void (async () => {
      const result = await submitIdentityClaim(profile.rootPersonId!);
      if (result.success) {
        console.log('[Profile] Migrated local claim to server:', profile.rootPersonId);
      }
    })();
  }, [isSignedIn, profileRow?.claimed_gedcom_id, profile?.rootPersonId, isClaimed]);

  const repairBrokenClaim = useCallback(
    async (showNotice: boolean) => {
      if (isSignedIn) {
        await clearIdentityClaim();
      }
      await AsyncStorage.removeItem(CLAIMED_KEY);
      setIsClaimed(false);
      if (profile?.rootPersonId || profile?.rootPersonName) {
        const updated: UserProfile = {
          ...(profile ?? {
            id: Date.now().toString(),
            displayName: '',
            createdAt: Date.now(),
          }),
          rootPersonId: undefined,
          rootPersonName: undefined,
        };
        await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
        setProfile(updated);
      }
      if (showNotice) {
        setClaimRepairNotice(true);
      }
    },
    [isSignedIn, profile]
  );

  const validateClaim = useCallback(async () => {
    const gedcomId = profileRow?.claimed_gedcom_id ?? profile?.rootPersonId;
    const hasClaimData =
      isClaimed || !!profile?.rootPersonId || !!profileRow?.claimed_gedcom_id;

    if (!hasClaimData) return;

    setIsValidatingClaim(true);
    try {
      if (!gedcomId) {
        await repairBrokenClaim(true);
        return;
      }

      const { data, error } = await supabase
        .from('individuals')
        .select('gedcom_id')
        .eq('gedcom_id', gedcomId)
        .limit(1);

      if (error) {
        const fetched = await fetchIndividualByGedcomId(gedcomId);
        if (!fetched) return;
      } else if (!data?.[0]) {
        await repairBrokenClaim(true);
        return;
      }

      if (profileRow?.claimed_gedcom_id) {
        if (profile?.rootPersonId !== profileRow.claimed_gedcom_id || !isClaimed) {
          await syncClaimFromServer();
        }
      }
    } finally {
      setIsValidatingClaim(false);
    }
  }, [
    profileRow?.claimed_gedcom_id,
    profile?.rootPersonId,
    isClaimed,
    repairBrokenClaim,
    syncClaimFromServer,
  ]);

  useEffect(() => {
    if (!isSignedIn || loadQuery.isLoading) return;
    void validateClaim();
  }, [isSignedIn, loadQuery.isLoading, validateClaim]);

  const dismissClaimRepairNotice = useCallback(() => {
    setClaimRepairNotice(false);
  }, []);

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
      // Sync real name for admin/pending-edit labels — not on identity claim.
      if (isSignedIn && updated.displayName.trim()) {
        void updateProfileDisplayName(updated.displayName.trim()).then((sync) => {
          if (!sync.success) {
            console.warn('[Profile] Failed to sync display name to cloud:', sync.error);
          }
        });
      }
    },
    [profile, saveMutation, isSignedIn]
  );

  const resetClaim = useCallback(async () => {
    await clearIdentityClaim();
    await AsyncStorage.removeItem(CLAIMED_KEY);
    setIsClaimed(false);
    setClaimRepairNotice(false);
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
      const serverResult = await submitIdentityClaim(personId);
      if (!serverResult.success) {
        throw new Error(serverResult.error ?? 'Failed to claim identity');
      }

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
    isValidatingClaim,
    claimRepairNotice,
    saveProfile,
    claimIdentity,
    resetClaim,
    dismissClaimRepairNotice,
    isSaving: saveMutation.isPending,
  }), [
    profile, hasProfile, hasClaimed, isClaimed, isValidatingClaim, claimRepairNotice,
    saveProfile, claimIdentity, resetClaim, dismissClaimRepairNotice, saveMutation.isPending,
  ]);
});
