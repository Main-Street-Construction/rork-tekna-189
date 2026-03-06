import { supabase } from './supabase';
import { GedcomIndividual, GedcomFamily, FamilyTreeData, PendingEdit, PendingEditType } from '@/types/genealogy';

const FETCH_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

interface SupabaseQueryResult<T> {
  data: T[] | null;
  error: { message: string; code?: string } | null;
}

async function fetchWithRetry<T>(
  queryFn: () => PromiseLike<SupabaseQueryResult<T>>,
  retries: number = MAX_RETRIES,
  delayMs: number = RETRY_DELAY_MS
): Promise<SupabaseQueryResult<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await Promise.race([
        Promise.resolve(queryFn()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS)
        ),
      ]);
      if (!result.error) return result;
      lastError = new Error(result.error.message);
      console.warn(`[Supabase] Attempt ${attempt + 1}/${retries} returned error: ${result.error.message}`);
      if (attempt === retries - 1) return result;
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Supabase] Attempt ${attempt + 1}/${retries} failed: ${msg}`);
      if (attempt === retries - 1) {
        return { data: null, error: { message: msg } };
      }
    }
    const backoff = delayMs * Math.pow(1.5, attempt);
    console.log(`[Supabase] Retrying in ${Math.round(backoff)}ms...`);
    await new Promise(resolve => setTimeout(resolve, backoff));
  }
  return { data: null, error: { message: lastError instanceof Error ? lastError.message : String(lastError) } };
}

export interface SupabaseIndividual {
  id: string;
  gedcom_id: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  notes: string | null;
  updated_at: string;
  created_at: string;
}

export interface SupabaseFamily {
  id: string;
  husband_id: string | null;
  wife_id: string | null;
  marriage_date: string | null;
  marriage_place: string | null;
  notes: string | null;
  gedcom_id: string;
}

export interface SupabaseFamilyMember {
  id: string;
  family_id: string;
  individual_id: string;
  role: string;
}

function _cleanGedcomName(raw: string): { full: string; given: string; surname: string } {
  if (!raw || !raw.trim()) return { full: '', given: '', surname: '' };
  const surnameMatch = raw.match(/\/([^/]*)\//);  
  if (surnameMatch) {
    const surname = surnameMatch[1].trim();
    const given = raw.replace(/\/[^/]*\/?/g, '').trim();
    const full = surname ? `${given} ${surname}`.trim() : given;
    return { full, given, surname };
  }
  return { full: raw.trim(), given: '', surname: '' };
}

function supabaseToIndividual(row: SupabaseIndividual): GedcomIndividual {
  const firstName = (row.first_name ?? '').trim();
  const lastName = (row.last_name ?? '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  let sex: 'M' | 'F' | 'U' = 'U';
  if (row.gender === 'M' || row.gender === 'F') {
    sex = row.gender;
  }

  return {
    id: row.gedcom_id,
    name: fullName,
    givenName: firstName,
    surname: lastName,
    sex,
    birthDate: row.birth_date ?? undefined,
    birthPlace: row.birth_place ?? undefined,
    deathDate: row.death_date ?? undefined,
    deathPlace: row.death_place ?? undefined,
    note: row.notes ?? undefined,
    familiesAsSpouse: [],
    familyAsChild: undefined,
  };
}

function individualToSupabaseRow(ind: GedcomIndividual): Record<string, unknown> {
  return {
    gedcom_id: ind.id,
    first_name: ind.givenName || ind.name?.split(' ').slice(0, -1).join(' ') || '',
    last_name: ind.surname || ind.name?.split(' ').pop() || '',
    gender: ind.sex === 'U' ? null : ind.sex,
    birth_date: ind.birthDate ?? null,
    birth_place: ind.birthPlace ?? null,
    death_date: ind.deathDate ?? null,
    death_place: ind.deathPlace ?? null,
    notes: ind.note ?? null,
    updated_at: new Date().toISOString(),
  };
}

function supabaseToFamily(
  row: SupabaseFamily,
  uuidToGedcomId: Map<string, string>,
  childGedcomIds: string[]
): GedcomFamily {
  const husbandGedcomId = row.husband_id ? uuidToGedcomId.get(row.husband_id) : undefined;
  const wifeGedcomId = row.wife_id ? uuidToGedcomId.get(row.wife_id) : undefined;

  if (row.husband_id && !husbandGedcomId) {
    console.warn('[Supabase] Could not resolve husband UUID:', row.husband_id, 'for family', row.gedcom_id);
  }
  if (row.wife_id && !wifeGedcomId) {
    console.warn('[Supabase] Could not resolve wife UUID:', row.wife_id, 'for family', row.gedcom_id);
  }

  return {
    id: row.gedcom_id,
    husbandId: husbandGedcomId,
    wifeId: wifeGedcomId,
    childrenIds: childGedcomIds,
    marriageDate: row.marriage_date ?? undefined,
    marriagePlace: row.marriage_place ?? undefined,
  };
}

async function resolveGedcomIdToUuid(gedcomId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('individuals')
      .select('id')
      .eq('gedcom_id', gedcomId)
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0].id;
  } catch {
    return null;
  }
}

async function _resolveFamilyGedcomIdToUuid(gedcomId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('families')
      .select('id')
      .eq('gedcom_id', gedcomId)
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0].id;
  } catch {
    return null;
  }
}

export async function loadAllFromSupabase(): Promise<{
  data: FamilyTreeData | null;
  error?: string;
}> {
  try {
    console.log('[Supabase] Loading all data from shared database...');

    const individuals = new Map<string, GedcomIndividual>();
    const uuidToGedcomId = new Map<string, string>();
    const familyUuidToGedcomId = new Map<string, string>();
    let indOffset = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      const { data: rows, error: indError } = await fetchWithRetry<SupabaseIndividual>(() =>
        supabase
          .from('individuals')
          .select('*')
          .range(indOffset, indOffset + PAGE_SIZE - 1)
      );

      if (indError) {
        console.error('[Supabase] Error fetching individuals:', indError);
        return { data: null, error: indError.message };
      }

      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        const typedRow = row as SupabaseIndividual;
        uuidToGedcomId.set(typedRow.id, typedRow.gedcom_id);
        const ind = supabaseToIndividual(typedRow);
        individuals.set(ind.id, ind);
        if (individuals.size <= 3) {
          console.log('[Supabase] Sample individual:', JSON.stringify({
            uuid: typedRow.id,
            gedcom_id: typedRow.gedcom_id,
            name: ind.name,
            givenName: ind.givenName,
            surname: ind.surname,
          }));
        }
      }

      console.log(`[Supabase] Loaded ${individuals.size} individuals so far`);
      if (rows.length < PAGE_SIZE) break;
      indOffset += PAGE_SIZE;
    }

    console.log(`[Supabase] Built UUID->gedcom_id map with ${uuidToGedcomId.size} entries`);

    const familyRows: SupabaseFamily[] = [];
    let famOffset = 0;

    while (true) {
      const { data: rows, error: famError } = await fetchWithRetry<SupabaseFamily>(() =>
        supabase
          .from('families')
          .select('*')
          .range(famOffset, famOffset + PAGE_SIZE - 1)
      );

      if (famError) {
        console.error('[Supabase] Error fetching families:', famError);
        return { data: null, error: famError.message };
      }

      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        const typedRow = row as SupabaseFamily;
        familyRows.push(typedRow);
        familyUuidToGedcomId.set(typedRow.id, typedRow.gedcom_id);
      }

      console.log(`[Supabase] Loaded ${familyRows.length} family rows so far`);
      if (rows.length < PAGE_SIZE) break;
      famOffset += PAGE_SIZE;
    }

    const familyChildrenMap = new Map<string, string[]>();
    let fmOffset = 0;

    while (true) {
      const { data: rows, error: fmError } = await fetchWithRetry<SupabaseFamilyMember>(() =>
        supabase
          .from('family_members')
          .select('*')
          .range(fmOffset, fmOffset + PAGE_SIZE - 1)
      );

      if (fmError) {
        console.error('[Supabase] Error fetching family_members:', fmError);
        break;
      }

      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        const typedRow = row as SupabaseFamilyMember;
        if (typedRow.role === 'child') {
          const familyGedcomId = familyUuidToGedcomId.get(typedRow.family_id);
          const childGedcomId = uuidToGedcomId.get(typedRow.individual_id);
          if (familyGedcomId && childGedcomId) {
            const existing = familyChildrenMap.get(familyGedcomId) ?? [];
            existing.push(childGedcomId);
            familyChildrenMap.set(familyGedcomId, existing);
          }
        }
      }

      console.log(`[Supabase] Processed ${fmOffset + rows.length} family_members rows`);
      if (rows.length < PAGE_SIZE) break;
      fmOffset += PAGE_SIZE;
    }

    console.log(`[Supabase] Family children map has ${familyChildrenMap.size} families with children`);

    const families = new Map<string, GedcomFamily>();
    for (const row of familyRows) {
      const childGedcomIds = familyChildrenMap.get(row.gedcom_id) ?? [];
      const fam = supabaseToFamily(row, uuidToGedcomId, childGedcomIds);
      families.set(fam.id, fam);
    }

    families.forEach((fam) => {
      if (fam.husbandId) {
        const husband = individuals.get(fam.husbandId);
        if (husband && !husband.familiesAsSpouse.includes(fam.id)) {
          individuals.set(fam.husbandId, {
            ...husband,
            familiesAsSpouse: [...husband.familiesAsSpouse, fam.id],
          });
        }
      }
      if (fam.wifeId) {
        const wife = individuals.get(fam.wifeId);
        if (wife && !wife.familiesAsSpouse.includes(fam.id)) {
          individuals.set(fam.wifeId, {
            ...wife,
            familiesAsSpouse: [...wife.familiesAsSpouse, fam.id],
          });
        }
      }
      for (const childId of fam.childrenIds) {
        const child = individuals.get(childId);
        if (child && !child.familyAsChild) {
          individuals.set(childId, {
            ...child,
            familyAsChild: fam.id,
          });
        }
      }
    });

    const sampleFam = Array.from(families.values()).slice(0, 2);
    sampleFam.forEach((f, i) => {
      console.log(`[Supabase] Sample family ${i}:`, JSON.stringify({
        id: f.id, husbandId: f.husbandId, wifeId: f.wifeId, childrenCount: f.childrenIds.length,
      }));
    });

    console.log(`[Supabase] Load complete: ${individuals.size} individuals, ${families.size} families`);
    return { data: { individuals, families } };
  } catch (e) {
    console.error('[Supabase] Load error:', e);
    return { data: null, error: String(e) };
  }
}

export async function updateIndividualInSupabase(
  individual: GedcomIndividual
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Supabase] Updating individual:', individual.id, individual.name);
    const row = individualToSupabaseRow(individual);

    const { error } = await supabase
      .from('individuals')
      .update(row)
      .eq('gedcom_id', individual.id);

    if (error) {
      console.error('[Supabase] Error updating individual:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e) {
    console.error('[Supabase] Update individual error:', e);
    return { success: false, error: String(e) };
  }
}

export async function createIndividualInSupabase(
  individual: GedcomIndividual
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Supabase] Creating individual:', individual.id, individual.name);
    const row = individualToSupabaseRow(individual);

    const { data: existing } = await supabase
      .from('individuals')
      .select('id')
      .eq('gedcom_id', individual.id)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log('[Supabase] Individual already exists, updating instead:', individual.id);
      const { error } = await supabase
        .from('individuals')
        .update(row)
        .eq('gedcom_id', individual.id);
      if (error) {
        console.error('[Supabase] Error updating existing individual:', error);
        return { success: false, error: error.message };
      }
      return { success: true };
    }

    const { error } = await supabase
      .from('individuals')
      .insert(row);

    if (error) {
      console.error('[Supabase] Error creating individual:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e) {
    console.error('[Supabase] Create individual error:', e);
    return { success: false, error: String(e) };
  }
}

export async function upsertFamilyInSupabase(
  family: GedcomFamily
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Supabase] Upserting family:', family.id, 'husband:', family.husbandId, 'wife:', family.wifeId);

    let husbandUuid: string | null = null;
    let wifeUuid: string | null = null;

    if (family.husbandId) {
      husbandUuid = await resolveGedcomIdToUuid(family.husbandId);
      console.log('[Supabase] Resolved husband', family.husbandId, '->', husbandUuid);
    }
    if (family.wifeId) {
      wifeUuid = await resolveGedcomIdToUuid(family.wifeId);
      console.log('[Supabase] Resolved wife', family.wifeId, '->', wifeUuid);
    }

    const row: Record<string, unknown> = {
      gedcom_id: family.id,
      husband_id: husbandUuid,
      wife_id: wifeUuid,
      marriage_date: family.marriageDate ?? null,
      marriage_place: family.marriagePlace ?? null,
    };

    const { data: existing } = await supabase
      .from('families')
      .select('id')
      .eq('gedcom_id', family.id)
      .limit(1);

    let familyUuid: string;

    if (existing && existing.length > 0) {
      familyUuid = existing[0].id;
      const { error } = await supabase
        .from('families')
        .update(row)
        .eq('gedcom_id', family.id);

      if (error) {
        console.error('[Supabase] Error updating family:', error);
        return { success: false, error: error.message };
      }
    } else {
      const { data: inserted, error } = await supabase
        .from('families')
        .insert(row)
        .select('id');

      if (error) {
        console.error('[Supabase] Error inserting family:', error);
        return { success: false, error: error.message };
      }
      familyUuid = inserted?.[0]?.id;
    }

    if (familyUuid && family.childrenIds.length > 0) {
      for (const childGedcomId of family.childrenIds) {
        const childUuid = await resolveGedcomIdToUuid(childGedcomId);
        if (!childUuid) {
          console.warn('[Supabase] Could not resolve child UUID for:', childGedcomId);
          continue;
        }

        const { data: existingMember } = await supabase
          .from('family_members')
          .select('id')
          .eq('family_id', familyUuid)
          .eq('individual_id', childUuid)
          .eq('role', 'child')
          .limit(1);

        if (!existingMember || existingMember.length === 0) {
          const { error: fmError } = await supabase
            .from('family_members')
            .insert({
              family_id: familyUuid,
              individual_id: childUuid,
              role: 'child',
            });
          if (fmError) {
            console.warn('[Supabase] Error inserting family_member:', fmError.message);
          } else {
            console.log('[Supabase] Added child', childGedcomId, 'to family', family.id);
          }
        }
      }
    }

    return { success: true };
  } catch (e) {
    console.error('[Supabase] Upsert family error:', e);
    return { success: false, error: String(e) };
  }
}

export async function submitPendingEdit(
  editType: PendingEditType,
  targetId: string,
  data: Record<string, unknown>,
  submittedBy: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Supabase] Submitting pending edit:', editType, targetId);
    const { error } = await supabase.from('pending_edits').insert({
      edit_type: editType,
      target_id: targetId,
      data,
      submitted_by: submittedBy,
      status: 'pending',
    });

    if (error) {
      console.error('[Supabase] Error submitting pending edit:', error);
      if (error.message.includes('does not exist') || error.code === '42P01') {
        return { success: false, error: 'Pending edits table not set up yet. Contact the admin.' };
      }
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    console.error('[Supabase] Submit pending edit error:', e);
    return { success: false, error: String(e) };
  }
}

export async function fetchPendingEdits(): Promise<{ edits: PendingEdit[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('pending_edits')
      .select('*')
      .eq('status', 'pending')
      .order('submitted_at', { ascending: false });

    if (error) {
      console.error('[Supabase] Error fetching pending edits:', error);
      if (error.message.includes('does not exist') || error.code === '42P01') {
        return { edits: [], error: 'Pending edits table not set up.' };
      }
      return { edits: [], error: error.message };
    }

    return { edits: (data ?? []) as PendingEdit[] };
  } catch (e) {
    console.error('[Supabase] Fetch pending edits error:', e);
    return { edits: [], error: String(e) };
  }
}

export async function reviewPendingEdit(
  editId: string,
  status: 'approved' | 'rejected',
  reviewerNote?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Supabase] Reviewing pending edit:', editId, status);
    const { error } = await supabase
      .from('pending_edits')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewer_note: reviewerNote ?? null,
      })
      .eq('id', editId);

    if (error) {
      console.error('[Supabase] Error reviewing pending edit:', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    console.error('[Supabase] Review pending edit error:', e);
    return { success: false, error: String(e) };
  }
}

export async function submitFeedback(
  message: string,
  userName?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Supabase] Submitting feedback from:', userName ?? 'Anonymous');
    const { error } = await supabase.from('feedback').insert({
      message,
      user_name: userName ?? 'Anonymous',
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error('[Supabase] Error submitting feedback:', error);
      if (error.message.includes('does not exist') || error.code === '42P01') {
        return { success: false, error: 'Feedback table not set up yet. Contact the admin.' };
      }
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    console.error('[Supabase] Submit feedback error:', e);
    return { success: false, error: String(e) };
  }
}

export async function fetchFeedback(): Promise<{ items: Array<{ id: string; message: string; user_name: string; created_at: string }>; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[Supabase] Error fetching feedback:', error);
      return { items: [], error: error.message };
    }

    return { items: (data ?? []) as Array<{ id: string; message: string; user_name: string; created_at: string }> };
  } catch (e) {
    console.error('[Supabase] Fetch feedback error:', e);
    return { items: [], error: String(e) };
  }
}

export async function getPendingEditCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('pending_edits')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
