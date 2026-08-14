import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
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
  fetchIndividualByGedcomId,
  fetchMyPendingEdits,
  LoadProgress,
} from '@/lib/supabase-db';
import { PendingEdit } from '@/types/genealogy';
import { useAuth } from '@/contexts/AuthContext';
import { adminMergeIndividuals } from '@/lib/supabase-rpc';

const STORAGE_KEY = 'family_tree_data';
const RAW_GEDCOM_KEY = 'raw_gedcom';

const LAST_CLOUD_SYNC_KEY = 'last_cloud_sync';
const DATA_FORMAT_VERSION_KEY = 'data_format_version';
const CURRENT_DATA_FORMAT_VERSION = '7';
const CLOUD_SYNC_INTERVAL = 12 * 60 * 60 * 1000;
const AUTO_SYNC_ON_LAUNCH_INTERVAL = 60 * 60 * 1000;
const BG_SYNC_START_DELAY_MS = 4000;
const AUTO_SYNC_DEBOUNCE_MS = 30_000;
const PARTIAL_SYNC_THRESHOLD = 0.95;
const MAX_ASYNC_STORAGE_BYTES = 4 * 1024 * 1024;

function safeFamiliesAsSpouse(arr: string[] | undefined | null): string[] {
  return Array.isArray(arr) ? arr : [];
}

function addFamilyToSpouseList(list: string[] | undefined | null, familyId: string): string[] {
  const safe = safeFamiliesAsSpouse(list);
  return safe.includes(familyId) ? safe : [...safe, familyId];
}

function maxNumericGedcomId(keys: Iterable<string>, prefix: string): number {
  let maxNum = 0;
  const pattern = new RegExp('^' + prefix + '(\\d+)$');
  for (const key of keys) {
    const match = key.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return maxNum;
}

async function getLastSyncAgeMs(): Promise<number | null> {
  const raw = await safeGetItem(LAST_CLOUD_SYNC_KEY);
  if (!raw) return null;
  const ts = parseInt(raw, 10);
  if (Number.isNaN(ts)) return null;
  return Date.now() - ts;
}

async function isAutoSyncDue(maxAgeMs: number): Promise<boolean> {
  const age = await getLastSyncAgeMs();
  if (age === null) return true;
  return age >= maxAgeMs;
}

function shouldRejectCloudReplace(
  incoming: FamilyTreeData,
  current: FamilyTreeData | null,
  claimedGedcomId: string | undefined,
  partialWarning?: string
): boolean {
  if (!current) return false;

  const currentCount = current.individuals.size;
  const incomingCount = incoming.individuals.size;

  if (claimedGedcomId && !incoming.individuals.has(claimedGedcomId)) {
    return true;
  }

  if (partialWarning && currentCount > 0) {
    const ratio = incomingCount / currentCount;
    if (ratio < PARTIAL_SYNC_THRESHOLD) {
      return true;
    }
  }

  return false;
}

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
  const { isAdmin, user, isSignedIn, isEnabled, profileRow } = useAuth();
  const [treeData, setTreeData] = useState<FamilyTreeData | null>(null);
  const treeDataRef = useRef<FamilyTreeData | null>(null);
  const nextIdRef = useRef<{ I: number; F: number }>({ I: 0, F: 0 });
  const [isReady, setIsReady] = useState<boolean>(false);
  const [pendingEditCount, setPendingEditCount] = useState<number>(0);
  const [isLoadingFromCloud, setIsLoadingFromCloud] = useState<boolean>(false);
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);
  const bgSyncRef = useRef<boolean>(false);
  const bgSyncInFlightRef = useRef<boolean>(false);
  const lastAutoSyncAttemptRef = useRef(0);
  const bgSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudRetryCountRef = useRef<number>(0);
  const MAX_AUTO_RETRIES = 3;

  const canLoadData = isSignedIn && isEnabled;

  const applyTreeData = useCallback((data: FamilyTreeData | null) => {
    treeDataRef.current = data;
    if (!data) {
      nextIdRef.current = { I: 0, F: 0 };
    } else {
      nextIdRef.current = {
        I: Math.max(nextIdRef.current.I, maxNumericGedcomId(data.individuals.keys(), 'I')),
        F: Math.max(nextIdRef.current.F, maxNumericGedcomId(data.families.keys(), 'F')),
      };
    }
    setTreeData(data);
  }, []);

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
        const claimedId = profileRow?.claimed_gedcom_id ?? undefined;
        if (shouldRejectCloudReplace(cloudResult.data, treeDataRef.current, claimedId, cloudResult.error)) {
          console.warn('[FamilyTree] Background sync skipped — would lose claimed person or partial data');
          setCloudError(cloudResult.error ?? 'Sync skipped to protect your claimed identity or incomplete data.');
          return;
        }
        console.log('[FamilyTree] Background sync complete:', cloudResult.data.individuals.size, 'individuals');
        await persistCloudData(cloudResult.data);
        applyTreeData(cloudResult.data);
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
  }, [handleProgress, persistCloudData, profileRow?.claimed_gedcom_id, applyTreeData]);

  const scheduleAutoSync = useCallback(
    (reason: string, maxAgeMs: number, delayMs: number) => {
      if (bgSyncTimerRef.current) {
        clearTimeout(bgSyncTimerRef.current);
        bgSyncTimerRef.current = null;
      }

      bgSyncTimerRef.current = setTimeout(() => {
        bgSyncTimerRef.current = null;
        void (async () => {
          if (bgSyncInFlightRef.current) return;

          const now = Date.now();
          if (now - lastAutoSyncAttemptRef.current < AUTO_SYNC_DEBOUNCE_MS) {
            console.log('[FamilyTree] Auto-sync debounced');
            return;
          }

          const syncDue = await isAutoSyncDue(maxAgeMs);
          if (!syncDue) {
            console.log('[FamilyTree] Auto-sync skipped — data is fresh enough');
            return;
          }

          lastAutoSyncAttemptRef.current = now;
          console.log('[FamilyTree] Auto-sync starting:', reason);
          await backgroundSyncFromCloud();
        })();
      }, delayMs);
    },
    [backgroundSyncFromCloud]
  );

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
      applyTreeData(loadQuery.data);
      setIsReady(true);
      setIsLoadingFromCloud(false);
      setLoadProgress(null);

      if (bgSyncRef.current) {
        bgSyncRef.current = false;
        scheduleAutoSync('app launch', AUTO_SYNC_ON_LAUNCH_INTERVAL, BG_SYNC_START_DELAY_MS);
      }
    }
  }, [loadQuery.data, scheduleAutoSync, applyTreeData]);

  useEffect(() => {
    if (!canLoadData) return;

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState !== 'active') return;
      scheduleAutoSync('app foreground', CLOUD_SYNC_INTERVAL, 2000);
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => {
      subscription.remove();
      if (bgSyncTimerRef.current) {
        clearTimeout(bgSyncTimerRef.current);
        bgSyncTimerRef.current = null;
      }
    };
  }, [canLoadData, scheduleAutoSync]);

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
      applyTreeData(null);
      setIsReady(false);
      setLastSyncResult(null);
    }
  }, [canLoadData, applyTreeData]);

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
      applyTreeData(data);
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
      applyTreeData(null);
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

  const resolveClaimedPerson = useCallback(
    async (gedcomId: string): Promise<GedcomIndividual | null> => {
      const current = treeDataRef.current;
      const local = current?.individuals.get(gedcomId);
      if (local) return local;

      const fetched = await fetchIndividualByGedcomId(gedcomId);
      const latest = treeDataRef.current;
      if (!fetched || !latest) return fetched;

      const updatedIndividuals = new Map(latest.individuals);
      updatedIndividuals.set(gedcomId, fetched);
      applyTreeData({ ...latest, individuals: updatedIndividuals });
      return fetched;
    },
    [applyTreeData]
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
      applyTreeData(result.data);
      setIsReady(true);
      console.log('[FamilyTree] Full reload complete:', result.data.individuals.size, 'individuals');
      return { success: true };
    }
    if (result.error) {
      setCloudError(result.error);
      return { success: false, error: result.error };
    }
    return { success: false, error: 'No data found in database' };
  }, [handleProgress, applyTreeData]);

  const refreshFromCloud = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setIsLoadingFromCloud(true);
    setCloudError(null);
    try {
      const current = treeDataRef.current;
      const localIndCount = current?.individuals.size ?? 0;
      const localFamCount = current?.families.size ?? 0;

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
  }, [fullReloadFromCloud]);

  const generateNewId = useCallback(
    (prefix: string): string => {
      const counterKey: 'I' | 'F' = prefix === 'F' ? 'F' : 'I';
      const current = treeDataRef.current;
      let treeMax = 0;
      if (current) {
        const existing = counterKey === 'F' ? current.families.keys() : current.individuals.keys();
        treeMax = maxNumericGedcomId(existing, prefix);
      }
      const next = Math.max(treeMax, nextIdRef.current[counterKey]) + 1;
      nextIdRef.current[counterKey] = next;
      return prefix + String(next);
    },
    []
  );

  const persistTreeData = useCallback(
    async (newTree: FamilyTreeData) => {
      applyTreeData(newTree);
      const serialized = serializeFamilyTreeData(newTree);
      await safeSetItem(STORAGE_KEY, serialized);
    },
    [applyTreeData]
  );

  const submitEdit = useCallback(
    async (
      editType:
        | 'update_person'
        | 'add_person'
        | 'add_child'
        | 'add_spouse'
        | 'link_spouses'
        | 'edit_marriage'
        | 'link_child'
        | 'edit_parent'
        | 'remove_child'
        | 'unlink_spouses',
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
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      console.log('[FamilyTree] Adding new person:', individual.id, individual.name);

      const updatedIndividuals = new Map(treeData.individuals);
      updatedIndividuals.set(individual.id, individual);
      const newTree = { ...treeData, individuals: updatedIndividuals };
      await persistTreeData(newTree);

      const result = await createIndividualInSupabase(individual);
      if (!result.success) {
        console.error('[FamilyTree] Cloud create failed, local saved:', result.error);
        return { success: false, error: result.error ?? 'Cloud create failed' };
      }

      return { success: true };
    },
    [persistTreeData]
  );

  const updatePerson = useCallback(
    async (individual: GedcomIndividual): Promise<{ success: boolean; error?: string }> => {
      const treeData = treeDataRef.current;
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
    [persistTreeData]
  );

  const addChildToFamily = useCallback(
    async (
      childIndividual: GedcomIndividual,
      familyId: string
    ): Promise<{ success: boolean; error?: string }> => {
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const family = treeData.families.get(familyId);
      if (!family) return { success: false, error: 'Family not found: ' + familyId };

      console.log('[FamilyTree] Adding child', childIndividual.id, 'to family', familyId);
      console.log('[FamilyTree] Family husband:', family.husbandId, 'wife:', family.wifeId);
      console.log('[FamilyTree] Child familiesAsSpouse:', childIndividual.familiesAsSpouse);

      const updatedChild: GedcomIndividual = {
        ...childIndividual,
        familiesAsSpouse: Array.isArray(childIndividual.familiesAsSpouse) ? childIndividual.familiesAsSpouse : [],
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
        return { success: false, error: 'Child saved locally but cloud sync failed: ' + indResult.error };
      }

      const famResult = await upsertFamilyInSupabase(updatedFamily);
      if (!famResult.success) {
        console.error('[FamilyTree] Cloud update family failed:', famResult.error);
        return { success: false, error: 'Child created but family link failed: ' + famResult.error };
      }

      console.log('[FamilyTree] Successfully added child', updatedChild.id, 'to family', familyId,
        '- parents:', family.husbandId, '/', family.wifeId);
      return { success: true };
    },
    [persistTreeData]
  );

  const createFamilyAndAddChild = useCallback(
    async (
      childIndividual: GedcomIndividual,
      parent1Id: string,
      parent2Id?: string
    ): Promise<{ success: boolean; familyId?: string; error?: string }> => {
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const newFamilyId = generateNewId('F');
      console.log('[FamilyTree] Creating new family', newFamilyId, 'for child', childIndividual.id);

      const parent1 = treeData.individuals.get(parent1Id);
      const parent2 = parent2Id ? treeData.individuals.get(parent2Id) : undefined;

      if (!parent1) {
        console.error('[FamilyTree] Parent1 not found:', parent1Id);
        return { success: false, error: 'Parent not found: ' + parent1Id };
      }

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

      console.log('[FamilyTree] New family', newFamilyId, '- husband:', husbandId, 'wife:', wifeId, 'child:', childIndividual.id);

      const newFamily: GedcomFamily = {
        id: newFamilyId,
        husbandId,
        wifeId,
        childrenIds: [childIndividual.id],
      };

      const updatedChild: GedcomIndividual = {
        ...childIndividual,
        familiesAsSpouse: Array.isArray(childIndividual.familiesAsSpouse) ? childIndividual.familiesAsSpouse : [],
        familyAsChild: newFamilyId,
      };

      const updatedIndividuals = new Map(treeData.individuals);
      updatedIndividuals.set(updatedChild.id, updatedChild);

      if (parent1) {
        const parent1Families = safeFamiliesAsSpouse(parent1.familiesAsSpouse);
        const updatedParent1: GedcomIndividual = {
          ...parent1,
          familiesAsSpouse: addFamilyToSpouseList(parent1Families, newFamilyId),
        };
        updatedIndividuals.set(parent1Id, updatedParent1);
      }
      if (parent2 && parent2Id) {
        const parent2Families = safeFamiliesAsSpouse(parent2.familiesAsSpouse);
        const updatedParent2: GedcomIndividual = {
          ...parent2,
          familiesAsSpouse: addFamilyToSpouseList(parent2Families, newFamilyId),
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

      const indResult = await createIndividualInSupabase(updatedChild);
      if (!indResult.success) {
        console.error('[FamilyTree] Cloud create child failed:', indResult.error);
        return { success: false, familyId: newFamilyId, error: 'Child saved locally but cloud sync failed: ' + indResult.error };
      }

      const famResult = await upsertFamilyInSupabase(newFamily);
      if (!famResult.success) {
        console.error('[FamilyTree] Cloud create family failed:', famResult.error);
        return { success: false, familyId: newFamilyId, error: 'Family link failed in cloud: ' + famResult.error };
      }

      console.log('[FamilyTree] Successfully created family', newFamilyId,
        'with child', updatedChild.id, '- parents:', husbandId, '/', wifeId);

      return { success: true, familyId: newFamilyId };
    },
    [generateNewId, persistTreeData]
  );

  const addSpouse = useCallback(
    async (
      personId: string,
      spouseIndividual: GedcomIndividual,
      marriageDate?: string,
      marriagePlace?: string
    ): Promise<{ success: boolean; familyId?: string; error?: string }> => {
      const treeData = treeDataRef.current;
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
        familiesAsSpouse: addFamilyToSpouseList(person.familiesAsSpouse, newFamilyId),
      };

      const updatedSpouse: GedcomIndividual = {
        ...spouseIndividual,
        familiesAsSpouse: addFamilyToSpouseList(spouseIndividual.familiesAsSpouse, newFamilyId),
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

      const spouseResult = await createIndividualInSupabase(updatedSpouse);
      if (!spouseResult.success) {
        console.error('[FamilyTree] Cloud create spouse failed:', spouseResult.error);
        return { success: false, familyId: newFamilyId, error: 'Spouse saved locally but cloud sync failed: ' + spouseResult.error };
      }

      const famResult = await upsertFamilyInSupabase(newFamily);
      if (!famResult.success) {
        console.error('[FamilyTree] Cloud create family failed:', famResult.error);
        return { success: false, familyId: newFamilyId, error: 'Family link failed in cloud: ' + famResult.error };
      }

      const personResult = await updateIndividualInSupabase(updatedPerson);
      if (!personResult.success) {
        console.error('[FamilyTree] Cloud update person failed:', personResult.error);
        return { success: false, familyId: newFamilyId, error: 'Spouse added but parent link failed in cloud: ' + personResult.error };
      }

      return { success: true, familyId: newFamilyId };
    },
    [generateNewId, persistTreeData]
  );

  const linkExistingSpouses = useCallback(
    async (
      person1Id: string,
      person2Id: string,
      marriageDate?: string,
      marriagePlace?: string
    ): Promise<{ success: boolean; familyId?: string; error?: string }> => {
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      let person1 = treeData.individuals.get(person1Id);
      let person2 = treeData.individuals.get(person2Id);

      if (!person1) {
        console.log('[FamilyTree] Person 1 not in local cache, fetching from Supabase:', person1Id);
        const fetched = await fetchIndividualByGedcomId(person1Id);
        if (fetched) {
          person1 = fetched;
          const latest = treeDataRef.current ?? treeData;
          const updatedIndividuals = new Map(latest.individuals);
          updatedIndividuals.set(person1Id, fetched);
          applyTreeData({ ...latest, individuals: updatedIndividuals });
        }
      }
      if (!person2) {
        console.log('[FamilyTree] Person 2 not in local cache, fetching from Supabase:', person2Id);
        const fetched = await fetchIndividualByGedcomId(person2Id);
        if (fetched) {
          person2 = fetched;
          const latest = treeDataRef.current ?? treeData;
          const updatedIndividuals = new Map(latest.individuals);
          updatedIndividuals.set(person2Id, fetched);
          applyTreeData({ ...latest, individuals: updatedIndividuals });
        }
      }

      if (!person1) return { success: false, error: `Person 1 (${person1Id}) not found in local data or database` };
      if (!person2) return { success: false, error: `Person 2 (${person2Id}) not found in local data or database` };

      const latestTree = treeDataRef.current ?? treeData;
      const existingFamily = Array.from(latestTree.families.values()).find((f) => {
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
        familiesAsSpouse: addFamilyToSpouseList(person1.familiesAsSpouse, newFamilyId),
      };
      const updatedPerson2: GedcomIndividual = {
        ...person2,
        familiesAsSpouse: addFamilyToSpouseList(person2.familiesAsSpouse, newFamilyId),
      };

      const updatedIndividuals = new Map(latestTree.individuals);
      updatedIndividuals.set(person1Id, updatedPerson1);
      updatedIndividuals.set(person2Id, updatedPerson2);

      const updatedFamilies = new Map(latestTree.families);
      updatedFamilies.set(newFamilyId, newFamily);

      const newTree: FamilyTreeData = {
        individuals: updatedIndividuals,
        families: updatedFamilies,
      };
      await persistTreeData(newTree);

      const famResult = await upsertFamilyInSupabase(newFamily);
      if (!famResult.success) {
        console.error('[FamilyTree] Cloud create family failed:', famResult.error);
        return { success: false, familyId: newFamilyId, error: 'Family link failed in cloud: ' + famResult.error };
      }

      const person1Result = await updateIndividualInSupabase(updatedPerson1);
      if (!person1Result.success) {
        console.error('[FamilyTree] Cloud update person1 failed:', person1Result.error);
        return { success: false, familyId: newFamilyId, error: 'Family created but person 1 link failed: ' + person1Result.error };
      }

      const person2Result = await updateIndividualInSupabase(updatedPerson2);
      if (!person2Result.success) {
        console.error('[FamilyTree] Cloud update person2 failed:', person2Result.error);
        return { success: false, familyId: newFamilyId, error: 'Family created but person 2 link failed: ' + person2Result.error };
      }

      return { success: true, familyId: newFamilyId };
    },
    [generateNewId, persistTreeData, applyTreeData]
  );

  const updateFamily = useCallback(
    async (family: GedcomFamily): Promise<{ success: boolean; error?: string }> => {
      const treeData = treeDataRef.current;
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
    [persistTreeData]
  );

  const createFamilyWithParents = useCallback(
    async (
      parent1Id: string,
      parent2Id?: string,
      marriageDate?: string,
      marriagePlace?: string
    ): Promise<{ success: boolean; familyId?: string; error?: string }> => {
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const parent1 = treeData.individuals.get(parent1Id);
      const parent2 = parent2Id ? treeData.individuals.get(parent2Id) : undefined;
      if (!parent1) return { success: false, error: 'Parent not found: ' + parent1Id };

      const newFamilyId = generateNewId('F');
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
      } else if (parent1.sex === 'F') {
        wifeId = parent1Id;
      } else {
        husbandId = parent1Id;
      }

      const newFamily: GedcomFamily = {
        id: newFamilyId,
        husbandId,
        wifeId,
        childrenIds: [],
        marriageDate,
        marriagePlace,
      };

      const updatedIndividuals = new Map(treeData.individuals);
      const updatedParent1: GedcomIndividual = {
        ...parent1,
        familiesAsSpouse: addFamilyToSpouseList(parent1.familiesAsSpouse, newFamilyId),
      };
      updatedIndividuals.set(parent1Id, updatedParent1);

      if (parent2 && parent2Id) {
        updatedIndividuals.set(parent2Id, {
          ...parent2,
          familiesAsSpouse: addFamilyToSpouseList(parent2.familiesAsSpouse, newFamilyId),
        });
      }

      const updatedFamilies = new Map(treeData.families);
      updatedFamilies.set(newFamilyId, newFamily);
      await persistTreeData({ individuals: updatedIndividuals, families: updatedFamilies });

      const famResult = await upsertFamilyInSupabase(newFamily);
      if (!famResult.success) {
        return { success: false, familyId: newFamilyId, error: famResult.error };
      }

      const p1Result = await updateIndividualInSupabase(updatedParent1);
      if (!p1Result.success) {
        return { success: false, familyId: newFamilyId, error: p1Result.error };
      }

      if (parent2 && parent2Id) {
        const p2Result = await updateIndividualInSupabase(updatedIndividuals.get(parent2Id)!);
        if (!p2Result.success) {
          return { success: false, familyId: newFamilyId, error: p2Result.error };
        }
      }

      return { success: true, familyId: newFamilyId };
    },
    [generateNewId, persistTreeData]
  );

  const resolvePerson = resolveClaimedPerson;

  const linkChildToFamily = useCallback(
    async (childId: string, familyId: string): Promise<{ success: boolean; error?: string }> => {
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const child = treeData.individuals.get(childId);
      const family = treeData.families.get(familyId);
      if (!child) return { success: false, error: 'Child not found: ' + childId };
      if (!family) return { success: false, error: 'Family not found: ' + familyId };
      if (family.childrenIds.includes(childId)) {
        return { success: false, error: 'This person is already a child in this family.' };
      }

      const updatedIndividuals = new Map(treeData.individuals);
      const updatedFamilies = new Map(treeData.families);

      if (child.familyAsChild && child.familyAsChild !== familyId) {
        const oldFamily = treeData.families.get(child.familyAsChild);
        if (oldFamily) {
          updatedFamilies.set(child.familyAsChild, {
            ...oldFamily,
            childrenIds: oldFamily.childrenIds.filter((cid) => cid !== childId),
          });
        }
      }

      const updatedChild: GedcomIndividual = {
        ...child,
        familiesAsSpouse: safeFamiliesAsSpouse(child.familiesAsSpouse),
        familyAsChild: familyId,
      };
      const updatedFamily: GedcomFamily = {
        ...family,
        childrenIds: family.childrenIds.includes(childId) ? family.childrenIds : [...family.childrenIds, childId],
      };

      updatedIndividuals.set(childId, updatedChild);
      updatedFamilies.set(familyId, updatedFamily);
      await persistTreeData({ individuals: updatedIndividuals, families: updatedFamilies });

      const childResult = await updateIndividualInSupabase(updatedChild);
      if (!childResult.success) {
        return { success: false, error: 'Child link saved locally but cloud sync failed: ' + childResult.error };
      }

      if (child.familyAsChild && child.familyAsChild !== familyId) {
        const oldFam = updatedFamilies.get(child.familyAsChild);
        if (oldFam) {
          const oldFamResult = await upsertFamilyInSupabase(oldFam);
          if (!oldFamResult.success) {
            return { success: false, error: 'Old family update failed: ' + oldFamResult.error };
          }
        }
      }

      const famResult = await upsertFamilyInSupabase(updatedFamily);
      if (!famResult.success) {
        return { success: false, error: 'Family link failed in cloud: ' + famResult.error };
      }

      return { success: true };
    },
    [persistTreeData]
  );

  const removeChildFromFamily = useCallback(
    async (childId: string, familyId: string): Promise<{ success: boolean; error?: string }> => {
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const child = treeData.individuals.get(childId);
      const family = treeData.families.get(familyId);
      if (!child) return { success: false, error: 'Child not found: ' + childId };
      if (!family) return { success: false, error: 'Family not found: ' + familyId };

      const updatedFamily: GedcomFamily = {
        ...family,
        childrenIds: family.childrenIds.filter((id) => id !== childId),
      };
      const updatedChild: GedcomIndividual = {
        ...child,
        familiesAsSpouse: safeFamiliesAsSpouse(child.familiesAsSpouse),
        familyAsChild: child.familyAsChild === familyId ? undefined : child.familyAsChild,
      };

      const updatedIndividuals = new Map(treeData.individuals);
      updatedIndividuals.set(childId, updatedChild);
      const updatedFamilies = new Map(treeData.families);
      updatedFamilies.set(familyId, updatedFamily);
      await persistTreeData({ individuals: updatedIndividuals, families: updatedFamilies });

      const childResult = await updateIndividualInSupabase(updatedChild);
      if (!childResult.success) {
        return { success: false, error: 'Child update failed in cloud: ' + childResult.error };
      }

      const famResult = await upsertFamilyInSupabase(updatedFamily);
      if (!famResult.success) {
        return { success: false, error: 'Family update failed in cloud: ' + famResult.error };
      }

      return { success: true };
    },
    [persistTreeData]
  );

  const editParentFamily = useCallback(
    async (childId: string, newFamilyId: string): Promise<{ success: boolean; error?: string }> => {
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const child = treeData.individuals.get(childId);
      const newFamily = treeData.families.get(newFamilyId);
      if (!child) return { success: false, error: 'Child not found: ' + childId };
      if (!newFamily) return { success: false, error: 'Family not found: ' + newFamilyId };

      const oldFamilyId = child.familyAsChild;
      const updatedIndividuals = new Map(treeData.individuals);
      const updatedFamilies = new Map(treeData.families);

      if (oldFamilyId && oldFamilyId !== newFamilyId) {
        const oldFamily = treeData.families.get(oldFamilyId);
        if (oldFamily) {
          updatedFamilies.set(oldFamilyId, {
            ...oldFamily,
            childrenIds: oldFamily.childrenIds.filter((id) => id !== childId),
          });
        }
      }

      const targetFamily = updatedFamilies.get(newFamilyId) ?? newFamily;
      const nextChildren = targetFamily.childrenIds.includes(childId)
        ? targetFamily.childrenIds
        : [...targetFamily.childrenIds, childId];
      updatedFamilies.set(newFamilyId, { ...targetFamily, childrenIds: nextChildren });

      updatedIndividuals.set(childId, {
        ...child,
        familiesAsSpouse: safeFamiliesAsSpouse(child.familiesAsSpouse),
        familyAsChild: newFamilyId,
      });

      await persistTreeData({ individuals: updatedIndividuals, families: updatedFamilies });

      const childResult = await updateIndividualInSupabase(updatedIndividuals.get(childId)!);
      if (!childResult.success) {
        return { success: false, error: 'Child update failed in cloud: ' + childResult.error };
      }

      if (oldFamilyId && oldFamilyId !== newFamilyId) {
        const oldFam = updatedFamilies.get(oldFamilyId);
        if (oldFam) {
          const oldFamResult = await upsertFamilyInSupabase(oldFam);
          if (!oldFamResult.success) {
            return { success: false, error: 'Old family update failed in cloud: ' + oldFamResult.error };
          }
        }
      }

      const newFamResult = await upsertFamilyInSupabase(updatedFamilies.get(newFamilyId)!);
      if (!newFamResult.success) {
        return { success: false, error: 'New family update failed in cloud: ' + newFamResult.error };
      }

      return { success: true };
    },
    [persistTreeData]
  );

  const unlinkSpouses = useCallback(
    async (familyId: string): Promise<{ success: boolean; error?: string }> => {
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };

      const family = treeData.families.get(familyId);
      if (!family) return { success: false, error: 'Family not found: ' + familyId };
      if (family.childrenIds.length > 0) {
        return {
          success: false,
          error: 'Cannot unlink spouses while this family has children. Edit parent links instead.',
        };
      }

      const updatedIndividuals = new Map(treeData.individuals);
      const spouseIds = [family.husbandId, family.wifeId].filter((id): id is string => !!id);

      for (const spouseId of spouseIds) {
        const spouse = updatedIndividuals.get(spouseId) ?? treeData.individuals.get(spouseId);
        if (!spouse) continue;
        updatedIndividuals.set(spouseId, {
          ...spouse,
          familiesAsSpouse: safeFamiliesAsSpouse(spouse.familiesAsSpouse).filter((fid) => fid !== familyId),
        });
      }

      const updatedFamilies = new Map(treeData.families);
      updatedFamilies.delete(familyId);
      await persistTreeData({ individuals: updatedIndividuals, families: updatedFamilies });

      for (const spouseId of spouseIds) {
        const spouse = updatedIndividuals.get(spouseId);
        if (spouse) {
          const result = await updateIndividualInSupabase(spouse);
          if (!result.success) {
            return { success: false, error: 'Spouse update failed in cloud: ' + result.error };
          }
        }
      }

      return { success: true };
    },
    [persistTreeData]
  );

  const loadPendingEdits = useCallback(async (): Promise<PendingEdit[]> => {
    const result = await fetchPendingEdits();
    setPendingEditCount(result.edits.length);
    return result.edits;
  }, []);

  const mergeIndividualsInTree = useCallback(
    async (keepId: string, mergeId: string): Promise<{ success: boolean; error?: string }> => {
      const treeData = treeDataRef.current;
      if (!treeData) return { success: false, error: 'No tree data loaded' };
      if (keepId === mergeId) return { success: false, error: 'Cannot merge a person with themselves' };

      const keep = treeData.individuals.get(keepId);
      const merge = treeData.individuals.get(mergeId);
      if (!keep || !merge) return { success: false, error: 'One or both people not found in local tree' };

      const rpcResult = await adminMergeIndividuals(keepId, mergeId);
      if (!rpcResult.success) return rpcResult;

      const updatedIndividuals = new Map(treeData.individuals);
      const updatedFamilies = new Map(treeData.families);

      updatedFamilies.forEach((family, familyId) => {
        const nextFamily = { ...family };
        if (nextFamily.husbandId === mergeId) nextFamily.husbandId = keepId;
        if (nextFamily.wifeId === mergeId) nextFamily.wifeId = keepId;
        nextFamily.childrenIds = Array.from(
          new Set(nextFamily.childrenIds.map((id) => (id === mergeId ? keepId : id)))
        );
        updatedFamilies.set(familyId, nextFamily);
      });

      updatedIndividuals.forEach((person, personId) => {
        if (personId === mergeId) return;
        let nextPerson = { ...person };
        if (personId === keepId) {
          nextPerson = {
            ...keep,
            familiesAsSpouse: Array.from(
              new Set([
                ...safeFamiliesAsSpouse(keep.familiesAsSpouse),
                ...safeFamiliesAsSpouse(merge.familiesAsSpouse),
              ])
            ),
            note: [keep.note, merge.note].filter(Boolean).join('\n') || keep.note,
          };
        }
        if (nextPerson.familyAsChild) {
          const fam = updatedFamilies.get(nextPerson.familyAsChild);
          if (fam && !fam.childrenIds.includes(nextPerson.id)) {
            nextPerson = { ...nextPerson, familyAsChild: undefined };
          }
        }
        updatedIndividuals.set(personId, nextPerson);
      });

      updatedIndividuals.delete(mergeId);

      await persistTreeData({ individuals: updatedIndividuals, families: updatedFamilies });
      return { success: true };
    },
    [persistTreeData]
  );

  const loadMyEdits = useCallback(async (): Promise<PendingEdit[]> => {
    if (!user?.id) return [];
    const result = await fetchMyPendingEdits(user.id);
    return result.edits;
  }, [user?.id]);

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
  const isDataIncomplete = Boolean(lastSyncResult?.includes('warnings') || lastSyncResult?.includes('Partial'));

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
    resolveClaimedPerson,
    resolvePerson,
    isImporting,
    importError,
    isAdmin,
    pendingEditCount,
    submitEdit,
    loadPendingEdits,
    loadMyEdits,
    reviewPendingEdit,
    refreshPendingCount,
    generateNewId,
    addPerson,
    updatePerson,
    addChildToFamily,
    createFamilyAndAddChild,
    createFamilyWithParents,
    addSpouse,
    linkExistingSpouses,
    linkChildToFamily,
    removeChildFromFamily,
    editParentFamily,
    unlinkSpouses,
    updateFamily,
    mergeIndividualsInTree,
    isLoadingFromCloud,
    isBackgroundSyncing,
    cloudError,
    loadProgress,
    lastSyncResult,
    isDataIncomplete,
    refreshFromCloud,
  }), [
    treeData, isReady, hasData, individualCount, familyCount,
    importGedcom, clearData, search, getPerson, resolveClaimedPerson, resolvePerson, isImporting, importError,
    isAdmin, pendingEditCount, submitEdit,
    loadPendingEdits, loadMyEdits, reviewPendingEdit, refreshPendingCount, generateNewId,
    addPerson, updatePerson, addChildToFamily, createFamilyAndAddChild, createFamilyWithParents,
    addSpouse, linkExistingSpouses, linkChildToFamily, removeChildFromFamily, editParentFamily, unlinkSpouses,
    updateFamily, mergeIndividualsInTree, isLoadingFromCloud,
    isBackgroundSyncing, cloudError, loadProgress, lastSyncResult, isDataIncomplete, refreshFromCloud,
  ]);
});
