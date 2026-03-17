import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory, Paths } from 'expo-file-system';
import { useMutation, useQuery } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { FamilyTreeData, GedcomIndividual, GedcomFamily } from '@/types/genealogy';
import {
  parseGedcom,
  serializeFamilyTreeData,
  deserializeFamilyTreeData,
  searchIndividuals,
} from '@/utils/gedcom-parser';

import {
  loadAllFromSupabase,
  updateIndividualInSupabase,
  createIndividualInSupabase,
  upsertFamilyInSupabase,
  submitPendingEdit,
  fetchPendingEdits,
  reviewPendingEdit as reviewPendingEditApi,
  getPendingEditCount,
  getCloudCounts,
  LoadProgress,
} from '@/lib/supabase-db';
import { PendingEdit } from '@/types/genealogy';
import { useAuth } from '@/contexts/AuthContext';

const STORAGE_KEY = 'family_tree_data';
const RAW_GEDCOM_KEY = 'raw_gedcom';

const LAST_CLOUD_SYNC_KEY = 'last_cloud_sync';
const DATA_FORMAT_VERSION_KEY = 'data_format_version';
const CURRENT_DATA_FORMAT_VERSION = '7';
const CLOUD_SYNC_INTERVAL = 12 * 60 * 60 * 1000;
const MAX_ASYNC_STORAGE_BYTES = 4 * 1024 * 1024;

let storageDisabled = false;

function getFileCacheDir(): Directory {
  return new Directory(Paths.document, 'tree_cache');
}

function readFileCache(key: string): string | null {
  if (Platform.OS === 'web') return null;
  try {
    const dir = getFileCacheDir();
    const file = new File(dir, key + '.json');
    if (!file.exists) return null;
    const content = file.textSync();
    console.log('[FamilyTree] Loaded from file cache for', key, '(' + Math.round(content.length / 1024) + 'KB)');
    return content;
  } catch (e) {
    console.warn('[FamilyTree] File cache read failed for', key, ':', e);
    return null;
  }
}

function writeFileCache(key: string, value: string): boolean {
  if (Platform.OS === 'web') return false;
  try {
    const dir = getFileCacheDir();
    if (!dir.exists) {
      dir.create();
    }
    const file = new File(dir, key + '.json');
    file.write(value);
    console.log('[FamilyTree] File cache write success for', key, '(' + Math.round(value.length / 1024) + 'KB)');
    return true;
  } catch (e) {
    console.warn('[FamilyTree] File cache write failed for', key, ':', e);
    return false;
  }
}

async function safeRemoveItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (e) {
    console.warn('[FamilyTree] Failed to remove key', key, ':', e);
  }
}

async function safeGetItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch (e) {
    console.warn('[FamilyTree] AsyncStorage read failed for key', key, ':', e);
    return null;
  }
}

async function aggressiveCleanup(): Promise<void> {
  console.warn('[FamilyTree] Running aggressive storage cleanup...');
  const keysToRemove = [STORAGE_KEY, RAW_GEDCOM_KEY, LAST_CLOUD_SYNC_KEY, DATA_FORMAT_VERSION_KEY];
  for (const k of keysToRemove) {
    await safeRemoveItem(k);
  }
}

async function safeSetItem(key: string, value: string): Promise<boolean> {
  if (storageDisabled) {
    return false;
  }

  if (value.length > MAX_ASYNC_STORAGE_BYTES) {
    const fileCached = writeFileCache(key, value);
    if (fileCached) {
      await safeRemoveItem(key);
      return true;
    }
    return false;
  }

  try {
    await AsyncStorage.setItem(key, value);
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('SQLITE_FULL') || msg.includes('disk is full') || msg.includes('code 13')) {
      const fileCached = writeFileCache(key, value);
      if (fileCached) {
        await aggressiveCleanup();
        return true;
      }
      storageDisabled = true;
    }
    return false;
  }
}

async function safeGetItemWithFileCache(key: string): Promise<string | null> {
  const asyncResult = await safeGetItem(key);
  if (asyncResult) return asyncResult;
  return readFileCache(key);
}

export const [FamilyTreeProvider, useFamilyTree] = createContextHook(() => {
  const { isAdmin, user, isSignedIn, isEnabled } = useAuth();
  const [treeData, setTreeData] = useState<FamilyTreeData | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [pendingEditCount, setPendingEditCount] = useState<number>(0);
  const [isLoadingFromCloud, setIsLoadingFromCloud] = useState<boolean>(false);
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);
  const bgSyncRef = useRef<boolean>(false);
  const bgSyncInFlightRef = useRef<boolean>(false);
  const cloudRetryCountRef = useRef<number>(0);
  const MAX_AUTO_RETRIES = 3;

  const canLoadData = isSignedIn && isEnabled;

  const handleProgress = useCallback((progress: LoadProgress) => {
    setLoadProgress(progress);
  }, []);

  const persistCloudData = useCallback(async (data: FamilyTreeData): Promise<boolean> => {
    try {
      const serialized = serializeFamilyTreeData(data);
      const cached = await safeSetItem(STORAGE_KEY, serialized);
      if (cached) {
        await safeSetItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));
        await safeSetItem(DATA_FORMAT_VERSION_KEY, CURRENT_DATA_FORMAT_VERSION);
      }
      return cached;
    } catch (e) {
      console.warn('[FamilyTree] Failed to persist cloud data:', e);
      return false;
    }
  }, []);

  const backgroundSyncFromCloud = useCallback(async () => {
    if (bgSyncInFlightRef.current) {
      console.log('[FamilyTree] Background sync already in flight, skipping');
      return;
    }
    bgSyncInFlightRef.current = true;
    setIsBackgroundSyncing(true);
    setCloudError(null);
    try {
      const cloudResult = await loadAllFromSupabase(handleProgress);
      if (cloudResult.data && cloudResult.data.individuals.size > 0) {
        console.log('[FamilyTree] Background sync complete:', cloudResult.data.individuals.size, 'individuals');
        await persistCloudData(cloudResult.data);
        setTreeData(cloudResult.data);
        cloudRetryCountRef.current = 0;
        if (cloudResult.error) {
          setLastSyncResult(`Synced with warnings: ${cloudResult.error}`);
        } else {
          setLastSyncResult(`Synced ${cloudResult.data.individuals.size.toLocaleString()} people`);
        }
      } else if (cloudResult.error) {
        console.warn('[FamilyTree] Background sync error:', cloudResult.error);
        setCloudError(cloudResult.error);
      }
    } catch (e) {
      console.warn('[FamilyTree] Background sync failed:', e);
      setCloudError(String(e));
    } finally {
      bgSyncInFlightRef.current = false;
      setIsBackgroundSyncing(false);
      setLoadProgress(null);
    }
  }, [handleProgress, persistCloudData]);

  const loadFromCloudWithRetry = useCallback(async (): Promise<FamilyTreeData | null> => {
    setIsLoadingFromCloud(true);
    setCloudError(null);

    for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[FamilyTree] Cloud load retry ${attempt}/${MAX_AUTO_RETRIES}...`);
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }

        const cloudResult = await loadAllFromSupabase(handleProgress);

        if (cloudResult.data && cloudResult.data.individuals.size > 0) {
          console.log('[FamilyTree] Loaded from Supabase:', cloudResult.data.individuals.size, 'individuals');
          await persistCloudData(cloudResult.data);
          cloudRetryCountRef.current = 0;

          if (cloudResult.error) {
            console.warn('[FamilyTree] Load completed with partial warning:', cloudResult.error);
            setLastSyncResult(`Loaded with warnings: ${cloudResult.error}`);
          }

          return cloudResult.data;
        }

        if (cloudResult.error) {
          console.warn(`[FamilyTree] Cloud load attempt ${attempt + 1} error:`, cloudResult.error);
          if (attempt === MAX_AUTO_RETRIES) {
            setCloudError(cloudResult.error);
          }
        }
      } catch (e) {
        console.warn(`[FamilyTree] Cloud load attempt ${attempt + 1} crashed:`, e);
        if (attempt === MAX_AUTO_RETRIES) {
          setCloudError(String(e));
        }
      }
    }

    setIsLoadingFromCloud(false);
    setLoadProgress(null);
    return null;
  }, [handleProgress, persistCloudData]);

  const loadQuery = useQuery({
    queryKey: ['familyTree'],
    queryFn: async (): Promise<FamilyTreeData | null> => {
      console.log('[FamilyTree] Loading data...');

      await safeRemoveItem(RAW_GEDCOM_KEY);

      const formatVersion = await safeGetItem(DATA_FORMAT_VERSION_KEY);
      const needsReformat = formatVersion !== CURRENT_DATA_FORMAT_VERSION;

      if (needsReformat) {
        console.log('[FamilyTree] Data format version mismatch, forcing fresh load from cloud');
        await safeRemoveItem(STORAGE_KEY);
        await safeRemoveItem(LAST_CLOUD_SYNC_KEY);
      }

      let stored: string | null = null;
      if (!needsReformat) {
        stored = await safeGetItemWithFileCache(STORAGE_KEY);
      }

      if (stored) {
        console.log('[FamilyTree] Found local cached data, loading instantly');
        try {
          const localData = deserializeFamilyTreeData(stored);
          if (localData.individuals.size > 0) {
            console.log('[FamilyTree] Cache loaded:', localData.individuals.size, 'individuals');
            bgSyncRef.current = true;
            return localData;
          }
        } catch (e) {
          console.warn('[FamilyTree] Cache deserialization failed, clearing:', e);
          await safeRemoveItem(STORAGE_KEY);
        }
      }

      console.log('[FamilyTree] No local cache or empty, loading from cloud...');
      const cloudData = await loadFromCloudWithRetry();

      if (cloudData) {
        return cloudData;
      }

      console.log('[FamilyTree] No data found after all attempts');
      return null;
    },
    enabled: canLoadData,
    staleTime: CLOUD_SYNC_INTERVAL,
    gcTime: CLOUD_SYNC_INTERVAL * 2,
    retry: 1,
    retryDelay: 5000,
  });

  useEffect(() => {
    if (loadQuery.data !== undefined) {
      setTreeData(loadQuery.data);
      setIsReady(true);
      setIsLoadingFromCloud(false);
      setLoadProgress(null);

      if (bgSyncRef.current) {
        bgSyncRef.current = false;
        setTimeout(() => {
          void backgroundSyncFromCloud();
        }, 500);
      }
    }
  }, [loadQuery.data, backgroundSyncFromCloud]);

  useEffect(() => {
    if (loadQuery.error && !treeData) {
      console.warn('[FamilyTree] Query error:', loadQuery.error);
      setCloudError(String(loadQuery.error));
      setIsLoadingFromCloud(false);
      setLoadProgress(null);
      setIsReady(true);
    }
  }, [loadQuery.error, treeData]);

  useEffect(() => {
    if (!canLoadData) {
      setTreeData(null);
      setIsReady(false);
      setLastSyncResult(null);
    }
  }, [canLoadData]);

  const importMutation = useMutation({
    mutationFn: async (gedcomContent: string) => {
      console.log('[FamilyTree] Importing GEDCOM data...');
      const parsed = parseGedcom(gedcomContent);
      const serialized = serializeFamilyTreeData(parsed);
      await safeSetItem(STORAGE_KEY, serialized);
      await safeSetItem(RAW_GEDCOM_KEY, gedcomContent);
      console.log('[FamilyTree] Import complete');
      return parsed;
    },
    onSuccess: (data) => {
      setTreeData(data);
      setIsReady(true);
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      storageDisabled = false;
      await safeRemoveItem(STORAGE_KEY);
      await safeRemoveItem(RAW_GEDCOM_KEY);
      await safeRemoveItem(LAST_CLOUD_SYNC_KEY);
      await safeRemoveItem(DATA_FORMAT_VERSION_KEY);
    },
    onSuccess: () => {
      setTreeData(null);
    },
  });

  const importGedcom = useCallback(
    async (content: string) => {
      storageDisabled = false;
      return importMutation.mutateAsync(content);
    },
    [importMutation]
  );

  const clearData = useCallback(() => {
    clearMutation.mutate();
  }, [clearMutation]);

  const search = useCallback(
    (query: string): GedcomIndividual[] => {
      if (!treeData) return [];
      return searchIndividuals(query, treeData);
    },
    [treeData]
  );

  const getPerson = useCallback(
    (id: string): GedcomIndividual | undefined => {
      return treeData?.individuals.get(id);
    },
    [treeData]
  );

  useEffect(() => {
    if (!isAdmin) return;
    const loadCount = async () => {
      const count = await getPendingEditCount();
      setPendingEditCount(count);
    };
    void loadCount();
  }, [isAdmin]);

  const fullReloadFromCloud = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    console.log('[FamilyTree] Performing full reload from cloud...');
    storageDisabled = false;
    await aggressiveCleanup();

    const result = await loadAllFromSupabase(handleProgress);
    if (result.data && result.data.individuals.size > 0) {
      const serialized = serializeFamilyTreeData(result.data);
      const cached = await safeSetItem(STORAGE_KEY, serialized);
      if (cached) {
        await safeSetItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));
        await safeSetItem(DATA_FORMAT_VERSION_KEY, CURRENT_DATA_FORMAT_VERSION);
      }
      setTreeData(result.data);
      setIsReady(true);
      console.log('[FamilyTree] Full reload complete:', result.data.individuals.size, 'individuals');
      return { success: true };
    }
    if (result.error) {
      setCloudError(result.error);
      return { success: false, error: result.error };
    }
    return { success: false, error: 'No data found in database' };
  }, [handleProgress]);

  const refreshFromCloud = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setIsLoadingFromCloud(true);
    setCloudError(null);
    try {
      const localIndCount = treeData?.individuals.size ?? 0;
      const localFamCount = treeData?.families.size ?? 0;

      if (localIndCount === 0) {
        console.log('[FamilyTree] No local data — doing full reload');
        const result = await fullReloadFromCloud();
        return result;
      }

      const cloudCounts = await getCloudCounts();
      if (!cloudCounts) {
        console.warn('[FamilyTree] Could not fetch cloud counts, doing full sync to be safe');
        const result = await fullReloadFromCloud();
        return result;
      }

      const indDiff = Math.abs(cloudCounts.individuals - localIndCount);
      const famDiff = Math.abs(cloudCounts.families - localFamCount);

      if (indDiff === 0 && famDiff === 0) {
        console.log('[FamilyTree] Data is up-to-date (local:', localIndCount, 'ind,', localFamCount, 'fam | cloud:', cloudCounts.individuals, 'ind,', cloudCounts.families, 'fam)');
        await safeSetItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));
        return { success: true };
      }

      console.log('[FamilyTree] Data mismatch detected (local:', localIndCount, 'ind,', localFamCount, 'fam | cloud:', cloudCounts.individuals, 'ind,', cloudCounts.families, 'fam) — syncing...');
      const result = await fullReloadFromCloud();
      return result;
    } catch (e) {
      const msg = String(e);
      setCloudError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoadingFromCloud(false);
    }
  }, [treeData, fullReloadFromCloud]);

  const generateNewId = useCallback(
    (prefix: string): string => {
      if (!treeData) return prefix + '1';
      const existing = prefix === 'I'
        ? Array.from(treeData.individuals.keys())
        : Array.from(treeData.families.keys());
      let maxNum = 0;
      for (const key of existing) {
        const pattern = new RegExp('^' + prefix + '(\\d+)$');
        const match = key.match(pattern);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
      return prefix + String(maxNum + 1);
    },
    [treeData]
  );

  const persistTreeData = useCallback(
    async (newTree: FamilyTreeData) => {
      setTreeData(newTree);
      const serialized = serializeFamilyTreeData(newTree);
      await safeSetItem(STORAGE_KEY, serialized);
    },
    []
  );

  const submitEdit = useCallback(
    async (
      editType: 'update_person' | 'add_person' | 'add_child' | 'add_spouse' | 'link_spouses' | 'edit_marriage',
      targetId: string,
      data: Record<string, unknown>
    ): Promise<{ success: boolean; error?: string }> => {
      const submitterId = user?.id ?? 'anonymous';
      return submitPendingEdit(editType, targetId, data, submitterId);
    },
    [user?.id]
  );

  const addPerson = useCallback(
    async (individual: GedcomIndividual): Promise<{ success: boolean; error?: string }> => {
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      console.log('[FamilyTree] Adding new person:', individual.id, individual.name);

      const updatedIndividuals = new Map(treeData.individuals);
      updatedIndividuals.set(individual.id, individual);
      const newTree = { ...treeData, individuals: updatedIndividuals };
      await persistTreeData(newTree);

      const result = await createIndividualInSupabase(individual);
      if (!result.success) {
        console.error('[FamilyTree] Cloud create failed, local saved:', result.error);
      }

      return { success: true };
    },
    [treeData, persistTreeData]
  );

  const updatePerson = useCallback(
    async (individual: GedcomIndividual): Promise<{ success: boolean; error?: string }> => {
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      console.log('[FamilyTree] Updating person:', individual.id, individual.name);

      const updatedIndividuals = new Map(treeData.individuals);
      updatedIndividuals.set(individual.id, individual);
      const newTree = { ...treeData, individuals: updatedIndividuals };
      await persistTreeData(newTree);

      const result = await updateIndividualInSupabase(individual);
      if (!result.success) {
        console.error('[FamilyTree] Cloud update failed, local saved:', result.error);
      }

      return { success: true };
    },
    [treeData, persistTreeData]
  );

  const addChildToFamily = useCallback(
    async (
      childIndividual: GedcomIndividual,
      familyId: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const family = treeData.families.get(familyId);
      if (!family) return { success: false, error: 'Family not found' };

      console.log('[FamilyTree] Adding child', childIndividual.id, 'to family', familyId);

      const updatedChild: GedcomIndividual = {
        ...childIndividual,
        familyAsChild: familyId,
      };

      const updatedFamily: GedcomFamily = {
        ...family,
        childrenIds: [...family.childrenIds, childIndividual.id],
      };

      const updatedIndividuals = new Map(treeData.individuals);
      updatedIndividuals.set(updatedChild.id, updatedChild);

      const updatedFamilies = new Map(treeData.families);
      updatedFamilies.set(familyId, updatedFamily);

      const newTree: FamilyTreeData = {
        individuals: updatedIndividuals,
        families: updatedFamilies,
      };
      await persistTreeData(newTree);

      const indResult = await createIndividualInSupabase(updatedChild);
      if (!indResult.success) {
        console.error('[FamilyTree] Cloud create child failed:', indResult.error);
      }
      const famResult = await upsertFamilyInSupabase(updatedFamily);
      if (!famResult.success) {
        console.error('[FamilyTree] Cloud update family failed:', famResult.error);
      }

      return { success: true };
    },
    [treeData, persistTreeData]
  );

  const createFamilyAndAddChild = useCallback(
    async (
      childIndividual: GedcomIndividual,
      parent1Id: string,
      parent2Id?: string
    ): Promise<{ success: boolean; familyId?: string; error?: string }> => {
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const newFamilyId = generateNewId('F');
      console.log('[FamilyTree] Creating new family', newFamilyId, 'for child', childIndividual.id);

      const parent1 = treeData.individuals.get(parent1Id);
      const parent2 = parent2Id ? treeData.individuals.get(parent2Id) : undefined;

      let husbandId: string | undefined;
      let wifeId: string | undefined;

      if (parent1 && parent2) {
        if (parent1.sex === 'F') {
          wifeId = parent1Id;
          husbandId = parent2Id;
        } else {
          husbandId = parent1Id;
          wifeId = parent2Id;
        }
      } else if (parent1) {
        if (parent1.sex === 'F') {
          wifeId = parent1Id;
        } else {
          husbandId = parent1Id;
        }
      }

      const newFamily: GedcomFamily = {
        id: newFamilyId,
        husbandId,
        wifeId,
        childrenIds: [childIndividual.id],
      };

      const updatedChild: GedcomIndividual = {
        ...childIndividual,
        familyAsChild: newFamilyId,
      };

      const updatedIndividuals = new Map(treeData.individuals);
      updatedIndividuals.set(updatedChild.id, updatedChild);

      if (parent1) {
        const updatedParent1: GedcomIndividual = {
          ...parent1,
          familiesAsSpouse: parent1.familiesAsSpouse.includes(newFamilyId)
            ? parent1.familiesAsSpouse
            : [...parent1.familiesAsSpouse, newFamilyId],
        };
        updatedIndividuals.set(parent1Id, updatedParent1);
      }
      if (parent2 && parent2Id) {
        const updatedParent2: GedcomIndividual = {
          ...parent2,
          familiesAsSpouse: parent2.familiesAsSpouse.includes(newFamilyId)
            ? parent2.familiesAsSpouse
            : [...parent2.familiesAsSpouse, newFamilyId],
        };
        updatedIndividuals.set(parent2Id, updatedParent2);
      }

      const updatedFamilies = new Map(treeData.families);
      updatedFamilies.set(newFamilyId, newFamily);

      const newTree: FamilyTreeData = {
        individuals: updatedIndividuals,
        families: updatedFamilies,
      };
      await persistTreeData(newTree);

      await createIndividualInSupabase(updatedChild);
      await upsertFamilyInSupabase(newFamily);
      if (parent1) {
        await updateIndividualInSupabase(updatedIndividuals.get(parent1Id)!);
      }
      if (parent2 && parent2Id) {
        await updateIndividualInSupabase(updatedIndividuals.get(parent2Id)!);
      }

      return { success: true, familyId: newFamilyId };
    },
    [treeData, generateNewId, persistTreeData]
  );

  const addSpouse = useCallback(
    async (
      personId: string,
      spouseIndividual: GedcomIndividual,
      marriageDate?: string,
      marriagePlace?: string
    ): Promise<{ success: boolean; familyId?: string; error?: string }> => {
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const person = treeData.individuals.get(personId);
      if (!person) return { success: false, error: 'Person not found' };

      const newFamilyId = generateNewId('F');
      console.log('[FamilyTree] Creating spouse family', newFamilyId, 'for', personId, '+', spouseIndividual.id);

      let husbandId: string | undefined;
      let wifeId: string | undefined;

      if (person.sex === 'F') {
        wifeId = personId;
        husbandId = spouseIndividual.id;
      } else {
        husbandId = personId;
        wifeId = spouseIndividual.id;
      }

      const newFamily: GedcomFamily = {
        id: newFamilyId,
        husbandId,
        wifeId,
        childrenIds: [],
        marriageDate,
        marriagePlace,
      };

      const updatedPerson: GedcomIndividual = {
        ...person,
        familiesAsSpouse: [...person.familiesAsSpouse, newFamilyId],
      };

      const updatedSpouse: GedcomIndividual = {
        ...spouseIndividual,
        familiesAsSpouse: [...spouseIndividual.familiesAsSpouse, newFamilyId],
      };

      const updatedIndividuals = new Map(treeData.individuals);
      updatedIndividuals.set(personId, updatedPerson);
      updatedIndividuals.set(spouseIndividual.id, updatedSpouse);

      const updatedFamilies = new Map(treeData.families);
      updatedFamilies.set(newFamilyId, newFamily);

      const newTree: FamilyTreeData = {
        individuals: updatedIndividuals,
        families: updatedFamilies,
      };
      await persistTreeData(newTree);

      await createIndividualInSupabase(updatedSpouse);
      await upsertFamilyInSupabase(newFamily);
      await updateIndividualInSupabase(updatedPerson);

      return { success: true, familyId: newFamilyId };
    },
    [treeData, generateNewId, persistTreeData]
  );

  const linkExistingSpouses = useCallback(
    async (
      person1Id: string,
      person2Id: string,
      marriageDate?: string,
      marriagePlace?: string
    ): Promise<{ success: boolean; familyId?: string; error?: string }> => {
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const person1 = treeData.individuals.get(person1Id);
      const person2 = treeData.individuals.get(person2Id);
      if (!person1) return { success: false, error: 'Person 1 not found' };
      if (!person2) return { success: false, error: 'Person 2 not found' };

      const existingFamily = Array.from(treeData.families.values()).find((f) => {
        return (
          (f.husbandId === person1Id && f.wifeId === person2Id) ||
          (f.husbandId === person2Id && f.wifeId === person1Id)
        );
      });
      if (existingFamily) {
        return { success: false, error: 'These two people are already linked as spouses.' };
      }

      const newFamilyId = generateNewId('F');
      console.log('[FamilyTree] Linking existing spouses', person1Id, '+', person2Id, 'as family', newFamilyId);

      let husbandId: string | undefined;
      let wifeId: string | undefined;

      if (person1.sex === 'F') {
        wifeId = person1Id;
        husbandId = person2Id;
      } else {
        husbandId = person1Id;
        wifeId = person2Id;
      }

      const newFamily: GedcomFamily = {
        id: newFamilyId,
        husbandId,
        wifeId,
        childrenIds: [],
        marriageDate,
        marriagePlace,
      };

      const updatedPerson1: GedcomIndividual = {
        ...person1,
        familiesAsSpouse: [...person1.familiesAsSpouse, newFamilyId],
      };
      const updatedPerson2: GedcomIndividual = {
        ...person2,
        familiesAsSpouse: [...person2.familiesAsSpouse, newFamilyId],
      };

      const updatedIndividuals = new Map(treeData.individuals);
      updatedIndividuals.set(person1Id, updatedPerson1);
      updatedIndividuals.set(person2Id, updatedPerson2);

      const updatedFamilies = new Map(treeData.families);
      updatedFamilies.set(newFamilyId, newFamily);

      const newTree: FamilyTreeData = {
        individuals: updatedIndividuals,
        families: updatedFamilies,
      };
      await persistTreeData(newTree);

      await upsertFamilyInSupabase(newFamily);
      await updateIndividualInSupabase(updatedPerson1);
      await updateIndividualInSupabase(updatedPerson2);

      return { success: true, familyId: newFamilyId };
    },
    [treeData, generateNewId, persistTreeData]
  );

  const updateFamily = useCallback(
    async (family: GedcomFamily): Promise<{ success: boolean; error?: string }> => {
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const updatedFamilies = new Map(treeData.families);
      updatedFamilies.set(family.id, family);
      const newTree: FamilyTreeData = { ...treeData, families: updatedFamilies };
      await persistTreeData(newTree);

      const result = await upsertFamilyInSupabase(family);
      if (!result.success) {
        console.error('[FamilyTree] Cloud update family failed:', result.error);
      }

      return { success: true };
    },
    [treeData, persistTreeData]
  );

  const loadPendingEdits = useCallback(async (): Promise<PendingEdit[]> => {
    const result = await fetchPendingEdits();
    setPendingEditCount(result.edits.length);
    return result.edits;
  }, []);

  const reviewPendingEdit = useCallback(
    async (
      editId: string,
      status: 'approved' | 'rejected',
      note?: string
    ): Promise<{ success: boolean; error?: string }> => {
      const result = await reviewPendingEditApi(editId, status, note);
      if (result.success) {
        const count = await getPendingEditCount();
        setPendingEditCount(count);
      }
      return result;
    },
    []
  );

  const refreshPendingCount = useCallback(async () => {
    if (!isAdmin) return;
    const count = await getPendingEditCount();
    setPendingEditCount(count);
  }, [isAdmin]);

  const individualCount = treeData?.individuals.size ?? 0;
  const familyCount = treeData?.families.size ?? 0;
  const hasData = treeData !== null && individualCount > 0;
  const isImporting = importMutation.isPending;
  const importError = importMutation.error;

  return useMemo(() => ({
    treeData,
    isReady,
    hasData,
    individualCount,
    familyCount,
    importGedcom,
    clearData,
    search,
    getPerson,
    isImporting,
    importError,
    isAdmin,
    pendingEditCount,
    submitEdit,
    loadPendingEdits,
    reviewPendingEdit,
    refreshPendingCount,
    generateNewId,
    addPerson,
    updatePerson,
    addChildToFamily,
    createFamilyAndAddChild,
    addSpouse,
    linkExistingSpouses,
    updateFamily,
    isLoadingFromCloud,
    isBackgroundSyncing,
    cloudError,
    loadProgress,
    lastSyncResult,
    refreshFromCloud,
  }), [
    treeData, isReady, hasData, individualCount, familyCount,
    importGedcom, clearData, search, getPerson, isImporting, importError,
    isAdmin, pendingEditCount, submitEdit,
    loadPendingEdits, reviewPendingEdit, refreshPendingCount, generateNewId,
    addPerson, updatePerson, addChildToFamily, createFamilyAndAddChild,
    addSpouse, linkExistingSpouses, updateFamily, isLoadingFromCloud,
    isBackgroundSyncing, cloudError, loadProgress, lastSyncResult, refreshFromCloud,
  ]);
});
