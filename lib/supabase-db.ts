import { supabase } from './supabase';
import { GedcomIndividual, GedcomFamily, FamilyTreeData, PendingEdit, PendingEditType } from '@/types/genealogy';

const FETCH_TIMEOUT_MS = 60000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const BATCH_PAGE_SIZE = 5000;
const MAX_CONCURRENT_PAGES = 6;

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

      if (attempt === retries - 1) return result;
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === retries - 1) {
        return { data: null, error: { message: msg } };
      }
    }
    const backoff = delayMs * Math.pow(1.5, attempt);
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

const INDIVIDUALS_COLUMNS = 'id,gedcom_id,first_name,last_name,gender,birth_date,birth_place,death_date,death_place,notes' as const;
const FAMILIES_COLUMNS = 'id,gedcom_id,husband_id,wife_id,marriage_date,marriage_place' as const;
const FAMILY_MEMBERS_COLUMNS = 'id,family_id,individual_id,role' as const;

async function getTableCount(table: string): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}

async function fetchPageRange<T>(
  table: string,
  columns: string,
  from: number,
  to: number
): Promise<{ data: T[]; error?: string }> {
  const result = await fetchWithRetry<T>(() =>
    supabase
      .from(table)
      .select(columns)
      .range(from, to) as unknown as PromiseLike<SupabaseQueryResult<T>>
  );
  if (result.error) {
    return { data: [], error: result.error.message };
  }
  return { data: (result.data ?? []) as T[] };
}

async function fetchAllPages<T>(
  table: string,
  columns: string = '*',
  pageSize: number = BATCH_PAGE_SIZE,
  onBatch?: (batchRows: T[], totalSoFar: number) => void
): Promise<{ rows: T[]; error?: string }> {
  const totalCount = await getTableCount(table);

  if (totalCount !== null && totalCount <= pageSize) {
    console.log(`[Supabase] ${table}: single fetch (${totalCount} rows)`);
    const result = await fetchPageRange<T>(table, columns, 0, totalCount - 1);
    if (result.error) {
      return { rows: [], error: result.error };
    }
    if (onBatch && result.data.length > 0) {
      onBatch(result.data, result.data.length);
    }
    return { rows: result.data };
  }

  if (totalCount !== null && totalCount > pageSize) {
    console.log(`[Supabase] ${table}: parallel fetch ${totalCount} rows in ${Math.ceil(totalCount / pageSize)} pages`);
    const pageCount = Math.ceil(totalCount / pageSize);
    const allRows: T[] = [];
    let completed = 0;

    for (let wave = 0; wave < pageCount; wave += MAX_CONCURRENT_PAGES) {
      const batch = [];
      for (let p = wave; p < Math.min(wave + MAX_CONCURRENT_PAGES, pageCount); p++) {
        const from = p * pageSize;
        const to = Math.min(from + pageSize - 1, totalCount - 1);
        batch.push(fetchPageRange<T>(table, columns, from, to));
      }

      const results = await Promise.all(batch);
      for (const r of results) {
        if (r.error) {
          console.warn(`[Supabase] ${table} page error:`, r.error);
        }
        if (r.data.length > 0) {
          for (let i = 0; i < r.data.length; i++) {
            allRows.push(r.data[i]);
          }
        }
        completed++;
        if (onBatch) {
          onBatch(r.data, allRows.length);
        }
      }
      console.log(`[Supabase] ${table}: completed ${completed}/${pageCount} pages (${allRows.length} rows)`);
    }

    return { rows: allRows };
  }

  console.log(`[Supabase] ${table}: sequential fallback (count unavailable)`);
  const allRows: T[] = [];
  let offset = 0;
  let consecutiveErrors = 0;

  while (true) {
    const { data: rows, error } = await fetchWithRetry<T>(() =>
      supabase
        .from(table)
        .select(columns)
        .range(offset, offset + pageSize - 1) as unknown as PromiseLike<SupabaseQueryResult<T>>
    );

    if (error) {
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        if (allRows.length > 0) {
          return { rows: allRows, error: `Partial fetch of ${table}: ${error.message}` };
        }
        return { rows: allRows, error: `Failed fetching ${table}: ${error.message}` };
      }
      await new Promise(r => setTimeout(r, 1500 * consecutiveErrors));
      continue;
    }

    consecutiveErrors = 0;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      allRows.push(row as T);
    }
    if (onBatch) {
      onBatch(rows as T[], allRows.length);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return { rows: allRows };
}

export type LoadProgress = {
  phase: 'loading' | 'assembling' | 'done';
  individualsLoaded: number;
  familiesLoaded: number;
  membersLoaded: number;
};

export async function loadAllFromSupabase(
  onProgress?: (progress: LoadProgress) => void
): Promise<{
  data: FamilyTreeData | null;
  error?: string;
}> {
  try {
    console.log('[Supabase] Loading data in parallel batches...');
    const startTime = Date.now();

    const progress: LoadProgress = {
      phase: 'loading',
      individualsLoaded: 0,
      familiesLoaded: 0,
      membersLoaded: 0,
    };

    const reportProgress = () => {
      if (onProgress) onProgress({ ...progress });
    };

    reportProgress();

    const [indResult, famResult, fmResult] = await Promise.all([
      fetchAllPages<SupabaseIndividual>('individuals', INDIVIDUALS_COLUMNS, BATCH_PAGE_SIZE, (_batch, total) => {
        progress.individualsLoaded = total;
        reportProgress();
      }),
      fetchAllPages<SupabaseFamily>('families', FAMILIES_COLUMNS, BATCH_PAGE_SIZE, (_batch, total) => {
        progress.familiesLoaded = total;
        reportProgress();
      }),
      fetchAllPages<SupabaseFamilyMember>('family_members', FAMILY_MEMBERS_COLUMNS, BATCH_PAGE_SIZE, (_batch, total) => {
        progress.membersLoaded = total;
        reportProgress();
      }),
    ]);

    if (indResult.error && indResult.rows.length === 0) {
      return { data: null, error: indResult.error };
    }
    console.log('[Supabase] Individuals done:', indResult.rows.length, 'in', Date.now() - startTime, 'ms');

    if (famResult.error && famResult.rows.length === 0) {
      return { data: null, error: famResult.error };
    }
    console.log('[Supabase] Families done:', famResult.rows.length, 'in', Date.now() - startTime, 'ms');
    console.log('[Supabase] Family members done:', fmResult.rows.length, 'in', Date.now() - startTime, 'ms');

    progress.phase = 'assembling';
    reportProgress();

    const individuals = new Map<string, GedcomIndividual>();
    const uuidToGedcomId = new Map<string, string>(indResult.rows.length);
    const familyUuidToGedcomId = new Map<string, string>(famResult.rows.length);

    for (let i = 0; i < indResult.rows.length; i++) {
      const row = indResult.rows[i];
      uuidToGedcomId.set(row.id, row.gedcom_id);
      individuals.set(row.gedcom_id, supabaseToIndividual(row));
    }

    for (let i = 0; i < famResult.rows.length; i++) {
      familyUuidToGedcomId.set(famResult.rows[i].id, famResult.rows[i].gedcom_id);
    }

    const familyChildrenMap = new Map<string, string[]>();
    for (let i = 0; i < fmResult.rows.length; i++) {
      const row = fmResult.rows[i];
      if (row.role === 'child') {
        const familyGedcomId = familyUuidToGedcomId.get(row.family_id);
        const childGedcomId = uuidToGedcomId.get(row.individual_id);
        if (familyGedcomId && childGedcomId) {
          const existing = familyChildrenMap.get(familyGedcomId);
          if (existing) {
            existing.push(childGedcomId);
          } else {
            familyChildrenMap.set(familyGedcomId, [childGedcomId]);
          }
        }
      }
    }

    const families = new Map<string, GedcomFamily>();
    for (let i = 0; i < famResult.rows.length; i++) {
      const row = famResult.rows[i];
      const childGedcomIds = familyChildrenMap.get(row.gedcom_id) ?? [];
      const fam = supabaseToFamily(row, uuidToGedcomId, childGedcomIds);
      families.set(fam.id, fam);
    }

    let spouseLinksSet = 0;
    let childLinksSet = 0;
    let childLinkSkipped = 0;

    families.forEach((fam) => {
      if (fam.husbandId) {
        const husband = individuals.get(fam.husbandId);
        if (husband) {
          husband.familiesAsSpouse.push(fam.id);
          spouseLinksSet++;
        }
      }
      if (fam.wifeId) {
        const wife = individuals.get(fam.wifeId);
        if (wife) {
          wife.familiesAsSpouse.push(fam.id);
          spouseLinksSet++;
        }
      }
      for (let c = 0; c < fam.childrenIds.length; c++) {
        const child = individuals.get(fam.childrenIds[c]);
        if (child && !child.familyAsChild) {
          child.familyAsChild = fam.id;
          childLinksSet++;
        } else if (child && child.familyAsChild) {
          childLinkSkipped++;
        }
      }
    });

    progress.phase = 'done';
    reportProgress();

    const elapsed = Date.now() - startTime;
    console.log('[Supabase] Data assembly complete:', individuals.size, 'individuals,', families.size, 'families in', elapsed, 'ms');
    console.log('[Supabase] Links: spouseLinks=' + spouseLinksSet + ', childLinksSet=' + childLinksSet + ', childLinkSkipped=' + childLinkSkipped);
    return { data: { individuals, families } };
  } catch (e) {
    console.error('[Supabase] loadAllFromSupabase crashed:', e);
    return { data: null, error: String(e) };
  }
}

export async function getCloudCounts(): Promise<{ individuals: number; families: number } | null> {
  try {

    const { count: indCount, error: indError } = await supabase
      .from('individuals')
      .select('*', { count: 'exact', head: true });

    if (indError) {

      return null;
    }

    const { count: famCount, error: famError } = await supabase
      .from('families')
      .select('*', { count: 'exact', head: true });

    if (famError) {

      return null;
    }


    return { individuals: indCount ?? 0, families: famCount ?? 0 };
  } catch {
    return null;
  }
}

export async function updateIndividualInSupabase(
  individual: GedcomIndividual
): Promise<{ success: boolean; error?: string }> {
  try {

    const row = individualToSupabaseRow(individual);

    const { error } = await supabase
      .from('individuals')
      .update(row)
      .eq('gedcom_id', individual.id);

    if (error) {

      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e) {

    return { success: false, error: String(e) };
  }
}

export async function createIndividualInSupabase(
  individual: GedcomIndividual
): Promise<{ success: boolean; error?: string }> {
  try {

    const row = individualToSupabaseRow(individual);

    const { data: existing } = await supabase
      .from('individuals')
      .select('id')
      .eq('gedcom_id', individual.id)
      .limit(1);

    if (existing && existing.length > 0) {

      const { error } = await supabase
        .from('individuals')
        .update(row)
        .eq('gedcom_id', individual.id);
      if (error) {

        return { success: false, error: error.message };
      }
      return { success: true };
    }

    const { error } = await supabase
      .from('individuals')
      .insert(row);

    if (error) {

      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e) {

    return { success: false, error: String(e) };
  }
}

export async function upsertFamilyInSupabase(
  family: GedcomFamily
): Promise<{ success: boolean; error?: string }> {
  try {


    let husbandUuid: string | null = null;
    let wifeUuid: string | null = null;

    if (family.husbandId) {
      husbandUuid = await resolveGedcomIdToUuid(family.husbandId);

    }
    if (family.wifeId) {
      wifeUuid = await resolveGedcomIdToUuid(family.wifeId);

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

        return { success: false, error: error.message };
      }
    } else {
      const { data: inserted, error } = await supabase
        .from('families')
        .insert(row)
        .select('id');

      if (error) {

        return { success: false, error: error.message };
      }
      familyUuid = inserted?.[0]?.id;
    }

    if (familyUuid && family.childrenIds.length > 0) {
      for (const childGedcomId of family.childrenIds) {
        const childUuid = await resolveGedcomIdToUuid(childGedcomId);
        if (!childUuid) {

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
          const { error: _fmError } = await supabase
            .from('family_members')
            .insert({
              family_id: familyUuid,
              individual_id: childUuid,
              role: 'child',
            });

        }
      }
    }

    return { success: true };
  } catch (e) {

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

    const { error } = await supabase.from('pending_edits').insert({
      edit_type: editType,
      target_id: targetId,
      data,
      submitted_by: submittedBy,
      status: 'pending',
    });

    if (error) {

      if (error.message.includes('does not exist') || error.code === '42P01') {
        return { success: false, error: 'Pending edits table not set up yet. Contact the admin.' };
      }
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {

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

      if (error.message.includes('does not exist') || error.code === '42P01') {
        return { edits: [], error: 'Pending edits table not set up.' };
      }
      return { edits: [], error: error.message };
    }

    return { edits: (data ?? []) as PendingEdit[] };
  } catch (e) {

    return { edits: [], error: String(e) };
  }
}

export async function reviewPendingEdit(
  editId: string,
  status: 'approved' | 'rejected',
  reviewerNote?: string
): Promise<{ success: boolean; error?: string }> {
  try {

    const { error } = await supabase
      .from('pending_edits')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewer_note: reviewerNote ?? null,
      })
      .eq('id', editId);

    if (error) {

      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {

    return { success: false, error: String(e) };
  }
}

export async function submitFeedback(
  message: string,
  userName?: string,
  contactEmail?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const row: Record<string, string> = {
      message,
      user_name: userName ?? 'Anonymous',
      created_at: new Date().toISOString(),
    };
    if (contactEmail) {
      row.contact_email = contactEmail;
    }

    const { error } = await supabase.from('feedback').insert(row);

    if (error) {

      if (error.message.includes('does not exist') || error.code === '42P01') {
        return { success: false, error: 'Feedback table not set up yet. Contact the admin.' };
      }
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {

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

      return { items: [], error: error.message };
    }

    return { items: (data ?? []) as Array<{ id: string; message: string; user_name: string; created_at: string }> };
  } catch (e) {

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
