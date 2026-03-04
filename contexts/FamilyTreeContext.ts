import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { FamilyTreeData, GedcomIndividual, GedcomFamily } from '@/types/genealogy';
import {
  parseGedcom,
  serializeFamilyTreeData,
  deserializeFamilyTreeData,
  searchIndividuals,
} from '@/utils/gedcom-parser';
import { DEFAULT_GEDCOM_URL, HAS_DEFAULT_GEDCOM, DEFAULT_GEDCOM_VERSION } from '@/data/default-gedcom';
import {
  loadAllFromSupabase,
  updateIndividualInSupabase,
  createIndividualInSupabase,
  upsertFamilyInSupabase,
  submitPendingEdit,
  fetchPendingEdits,
  reviewPendingEdit as reviewPendingEditApi,
  getPendingEditCount,
} from '@/lib/supabase-db';
import { PendingEdit } from '@/types/genealogy';
import { ADMIN_PASSWORD, ADMIN_AUTHENTICATED_KEY } from '@/constants/admin';

const STORAGE_KEY = 'family_tree_data';
const RAW_GEDCOM_KEY = 'raw_gedcom';
const AUTO_LOADED_KEY = 'auto_loaded_default';
const AUTO_LOADED_VERSION_KEY = 'auto_loaded_version';
const DEVICE_ID_KEY = 'device_id';
const LAST_CLOUD_SYNC_KEY = 'last_cloud_sync';
const DATA_FORMAT_VERSION_KEY = 'data_format_version';
const CURRENT_DATA_FORMAT_VERSION = '6';
const CLOUD_SYNC_INTERVAL = 4 * 60 * 60 * 1000;

async function getDeviceId(): Promise<string> {
  let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

export const [FamilyTreeProvider, useFamilyTree] = createContextHook(() => {
  const [treeData, setTreeData] = useState<FamilyTreeData | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isAutoLoading, setIsAutoLoading] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [pendingEditCount, setPendingEditCount] = useState<number>(0);
  const [isLoadingFromCloud, setIsLoadingFromCloud] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const autoLoadAttempted = useRef(false);
  const [loadFailed, setLoadFailed] = useState<boolean>(false);

  const loadQuery = useQuery({
    queryKey: ['familyTree'],
    queryFn: async () => {
      console.log('[FamilyTree] Loading data...');

      const adminStored = await AsyncStorage.getItem(ADMIN_AUTHENTICATED_KEY);
      if (adminStored === 'true') {
        setIsAdmin(true);
      }

      const formatVersion = await AsyncStorage.getItem(DATA_FORMAT_VERSION_KEY);
      const needsReformat = formatVersion !== CURRENT_DATA_FORMAT_VERSION;

      if (needsReformat) {
        console.log('[FamilyTree] Data format version mismatch, forcing fresh load from cloud');
        await AsyncStorage.removeItem(STORAGE_KEY);
        await AsyncStorage.removeItem(LAST_CLOUD_SYNC_KEY);
      }

      const stored = !needsReformat ? await AsyncStorage.getItem(STORAGE_KEY) : null;
      if (stored) {
        console.log('[FamilyTree] Found local cached data, loading instantly');
        const localData = deserializeFamilyTreeData(stored);
        if (localData.individuals.size > 0) {
          const sample = Array.from(localData.individuals.values()).slice(0, 2);
          sample.forEach((p, i) => {
            console.log(`[FamilyTree] Cached sample ${i}:`, p.id, '|', p.name, '| given:', p.givenName, '| surname:', p.surname);
          });
        }

        const lastSync = await AsyncStorage.getItem(LAST_CLOUD_SYNC_KEY);
        const lastSyncTime = lastSync ? parseInt(lastSync, 10) : 0;
        const timeSinceSync = Date.now() - lastSyncTime;

        if (timeSinceSync > CLOUD_SYNC_INTERVAL) {
          console.log('[FamilyTree] Cache stale, syncing from cloud in background');
          backgroundSyncFromCloud();
        } else {
          console.log('[FamilyTree] Cache fresh (synced', Math.round(timeSinceSync / 60000), 'min ago), skipping cloud sync');
        }

        return localData;
      }

      console.log('[FamilyTree] No local cache, loading from cloud...');
      setIsLoadingFromCloud(true);
      setCloudError(null);
      setLoadFailed(false);
      try {
        const cloudResult = await loadAllFromSupabase();
        if (cloudResult.data && cloudResult.data.individuals.size > 0) {
          console.log('[FamilyTree] Loaded from Supabase:', cloudResult.data.individuals.size, 'individuals');
          const serialized = serializeFamilyTreeData(cloudResult.data);
          await AsyncStorage.setItem(STORAGE_KEY, serialized);
          await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));
          await AsyncStorage.setItem(DATA_FORMAT_VERSION_KEY, CURRENT_DATA_FORMAT_VERSION);
          setIsLoadingFromCloud(false);
          return cloudResult.data;
        }
        if (cloudResult.error) {
          console.warn('[FamilyTree] Supabase load error:', cloudResult.error);
          setCloudError(cloudResult.error);
          setLoadFailed(true);
        }
      } catch (e) {
        console.warn('[FamilyTree] Supabase load failed:', e);
        setCloudError(String(e));
        setLoadFailed(true);
      }
      setIsLoadingFromCloud(false);

      console.log('[FamilyTree] No data found');
      return null;
    },
  });

  const backgroundSyncFromCloud = useCallback(async () => {
    setIsLoadingFromCloud(true);
    setCloudError(null);
    try {
      const cloudResult = await loadAllFromSupabase();
      if (cloudResult.data && cloudResult.data.individuals.size > 0) {
        console.log('[FamilyTree] Background sync complete:', cloudResult.data.individuals.size, 'individuals');
        const serialized = serializeFamilyTreeData(cloudResult.data);
        await AsyncStorage.setItem(STORAGE_KEY, serialized);
        await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));
        setTreeData(cloudResult.data);
      } else if (cloudResult.error) {
        console.warn('[FamilyTree] Background sync error:', cloudResult.error);
        setCloudError(cloudResult.error);
      }
    } catch (e) {
      console.warn('[FamilyTree] Background sync failed:', e);
      setCloudError(String(e));
    } finally {
      setIsLoadingFromCloud(false);
    }
  }, []);

  useEffect(() => {
    if (loadQuery.data !== undefined) {
      setTreeData(loadQuery.data);
      setIsReady(true);
    }
  }, [loadQuery.data]);

  useEffect(() => {
    if (!isReady || autoLoadAttempted.current) return;
    if (treeData !== null) return;
    if (!HAS_DEFAULT_GEDCOM) return;

    autoLoadAttempted.current = true;

    const autoLoad = async () => {
      try {
        const loadedVersion = await AsyncStorage.getItem(AUTO_LOADED_VERSION_KEY);
        if (loadedVersion === DEFAULT_GEDCOM_VERSION) {
          console.log('[FamilyTree] Default already loaded (version match), skipping');
          return;
        }

        console.log('[FamilyTree] Auto-loading default GEDCOM from:', DEFAULT_GEDCOM_URL);
        setIsAutoLoading(true);

        const response = await fetch(DEFAULT_GEDCOM_URL);
        if (!response.ok) {
          console.warn('[FamilyTree] Failed to fetch default GEDCOM:', response.status);
          setIsAutoLoading(false);
          return;
        }

        const content = await response.text();
        console.log('[FamilyTree] Fetched default GEDCOM, length:', content.length);

        if (!content.includes('INDI') && !content.includes('HEAD')) {
          console.warn('[FamilyTree] Fetched content does not look like valid GEDCOM');
          setIsAutoLoading(false);
          setLoadFailed(true);
          return;
        }

        const parsed = parseGedcom(content);
        const serialized = serializeFamilyTreeData(parsed);
        await AsyncStorage.setItem(STORAGE_KEY, serialized);
        await AsyncStorage.setItem(RAW_GEDCOM_KEY, content);
        await AsyncStorage.setItem(AUTO_LOADED_KEY, 'true');
        await AsyncStorage.setItem(AUTO_LOADED_VERSION_KEY, DEFAULT_GEDCOM_VERSION);

        setTreeData(parsed);
        setLoadFailed(false);
        console.log('[FamilyTree] Default GEDCOM auto-loaded successfully');
      } catch (e) {
        console.error('[FamilyTree] Auto-load error:', e);
        setLoadFailed(true);
      } finally {
        setIsAutoLoading(false);
      }
    };

    autoLoad();
  }, [isReady, treeData]);

  const importMutation = useMutation({
    mutationFn: async (gedcomContent: string) => {
      console.log('[FamilyTree] Importing GEDCOM data...');
      const parsed = parseGedcom(gedcomContent);
      const serialized = serializeFamilyTreeData(parsed);
      await AsyncStorage.setItem(STORAGE_KEY, serialized);
      await AsyncStorage.setItem(RAW_GEDCOM_KEY, gedcomContent);
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
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(RAW_GEDCOM_KEY);
      await AsyncStorage.removeItem(AUTO_LOADED_KEY);
    },
    onSuccess: () => {
      setTreeData(null);
    },
  });

  const importGedcom = useCallback(
    async (content: string) => {
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

  const authenticateAdmin = useCallback(async (password: string): Promise<boolean> => {
    if (password === ADMIN_PASSWORD) {
      setIsAdmin(true);
      await AsyncStorage.setItem(ADMIN_AUTHENTICATED_KEY, 'true');
      console.log('[FamilyTree] Admin authenticated');
      const count = await getPendingEditCount();
      setPendingEditCount(count);
      return true;
    }
    return false;
  }, []);

  const logoutAdmin = useCallback(async () => {
    setIsAdmin(false);
    setPendingEditCount(0);
    await AsyncStorage.removeItem(ADMIN_AUTHENTICATED_KEY);
    console.log('[FamilyTree] Admin logged out');
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const loadCount = async () => {
      const count = await getPendingEditCount();
      setPendingEditCount(count);
    };
    loadCount();
  }, [isAdmin]);

  const forceReloadData = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    console.log('[FamilyTree] Force reloading all data from server...');
    setLoadFailed(false);
    setCloudError(null);
    setIsLoadingFromCloud(true);
    autoLoadAttempted.current = false;

    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(RAW_GEDCOM_KEY);
      await AsyncStorage.removeItem(AUTO_LOADED_KEY);
      await AsyncStorage.removeItem(AUTO_LOADED_VERSION_KEY);
      await AsyncStorage.removeItem(LAST_CLOUD_SYNC_KEY);
      await AsyncStorage.removeItem(DATA_FORMAT_VERSION_KEY);
      console.log('[FamilyTree] Cleared all cached data');
    } catch (e) {
      console.warn('[FamilyTree] Error clearing cache:', e);
    }

    try {
      const cloudResult = await loadAllFromSupabase();
      if (cloudResult.data && cloudResult.data.individuals.size > 0) {
        console.log('[FamilyTree] Force reload from Supabase success:', cloudResult.data.individuals.size, 'individuals');
        const serialized = serializeFamilyTreeData(cloudResult.data);
        await AsyncStorage.setItem(STORAGE_KEY, serialized);
        await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));
        await AsyncStorage.setItem(DATA_FORMAT_VERSION_KEY, CURRENT_DATA_FORMAT_VERSION);
        setTreeData(cloudResult.data);
        setIsLoadingFromCloud(false);
        return { success: true };
      }
      if (cloudResult.error) {
        console.warn('[FamilyTree] Supabase force reload error:', cloudResult.error);
        setCloudError(cloudResult.error);
      }
    } catch (e) {
      console.warn('[FamilyTree] Supabase force reload failed:', e);
      setCloudError(String(e));
    }

    if (HAS_DEFAULT_GEDCOM) {
      console.log('[FamilyTree] Falling back to GEDCOM file download...');
      try {
        const response = await fetch(DEFAULT_GEDCOM_URL);
        if (response.ok) {
          const content = await response.text();
          if (content.includes('INDI') || content.includes('HEAD')) {
            const parsed = parseGedcom(content);
            const serialized = serializeFamilyTreeData(parsed);
            await AsyncStorage.setItem(STORAGE_KEY, serialized);
            await AsyncStorage.setItem(RAW_GEDCOM_KEY, content);
            await AsyncStorage.setItem(AUTO_LOADED_KEY, 'true');
            await AsyncStorage.setItem(AUTO_LOADED_VERSION_KEY, DEFAULT_GEDCOM_VERSION);
            setTreeData(parsed);
            setIsLoadingFromCloud(false);
            console.log('[FamilyTree] Force reload from GEDCOM file success');
            return { success: true };
          }
        }
      } catch (e) {
        console.warn('[FamilyTree] GEDCOM file fallback failed:', e);
      }
    }

    setLoadFailed(true);
    setIsLoadingFromCloud(false);
    return { success: false, error: 'Failed to reload data from server. Please check your connection and try again.' };
  }, []);

  const refreshFromCloud = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setIsLoadingFromCloud(true);
    setCloudError(null);
    try {
      const result = await loadAllFromSupabase();
      if (result.data && result.data.individuals.size > 0) {
        const serialized = serializeFamilyTreeData(result.data);
        await AsyncStorage.setItem(STORAGE_KEY, serialized);
        await AsyncStorage.setItem(LAST_CLOUD_SYNC_KEY, String(Date.now()));
        setTreeData(result.data);
        setIsLoadingFromCloud(false);
        console.log('[FamilyTree] Refreshed from Supabase');
        return { success: true };
      }
      setIsLoadingFromCloud(false);
      if (result.error) {
        setCloudError(result.error);
        return { success: false, error: result.error };
      }
      return { success: false, error: 'No data found in database' };
    } catch (e) {
      const msg = String(e);
      setCloudError(msg);
      setIsLoadingFromCloud(false);
      return { success: false, error: msg };
    }
  }, []);

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
      await AsyncStorage.setItem(STORAGE_KEY, serialized);
    },
    []
  );

  const submitEdit = useCallback(
    async (
      editType: 'update_person' | 'add_person' | 'add_child' | 'add_spouse' | 'link_spouses' | 'edit_marriage',
      targetId: string,
      data: Record<string, unknown>
    ): Promise<{ success: boolean; error?: string }> => {
      const deviceId = await getDeviceId();
      return submitPendingEdit(editType, targetId, data, deviceId);
    },
    []
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

  return {
    treeData,
    isReady,
    isAutoLoading,
    hasData,
    individualCount,
    familyCount,
    importGedcom,
    clearData,
    search,
    getPerson,
    isImporting: importMutation.isPending,
    importError: importMutation.error,
    isAdmin,
    authenticateAdmin,
    logoutAdmin,
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
    cloudError,
    refreshFromCloud,
    loadFailed,
    forceReloadData,
  };
});
