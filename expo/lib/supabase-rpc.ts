import { supabase } from './supabase';

export async function setProfileFullName(fullName: string): Promise<{ success: boolean; error?: string; userId?: string }> {
  const { data, error } = await supabase.rpc('set_profile_full_name', { full_name: fullName });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string; user_id?: string };
  if (!result.success) return { success: false, error: result.error };
  return { success: true, userId: result.user_id };
}

export async function notifyAdminsAccessRequest(userId: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('notify-admins-access-request', {
      body: { user_id: userId },
    });
    if (error) {
      console.warn('[RPC] notify-admins-access-request failed:', error.message);
    }
  } catch (e) {
    console.warn('[RPC] notify-admins-access-request error:', e);
  }
}

export async function submitIdentityClaim(gedcomId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('submit_identity_claim', { gedcom_id: gedcomId });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function clearIdentityClaim(): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('clear_identity_claim');
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function adminResetUserClaim(targetUserId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_reset_user_claim', { target_user_id: targetUserId });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function registerPushToken(
  expoPushToken: string,
  platform: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('register_push_token', {
    expo_push_token: expoPushToken,
    platform,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function unregisterPushToken(expoPushToken: string): Promise<void> {
  await supabase.rpc('unregister_push_token', { expo_push_token: expoPushToken });
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  is_enabled: boolean;
  is_admin: boolean;
  created_at: string | null;
  email_confirmed: boolean;
  last_sign_in_at: string | null;
  claimed_gedcom_id: string | null;
  claimed_person_name: string | null;
}

export async function adminListUsersWithEmail(): Promise<{ users: AdminUserRow[]; error?: string }> {
  const { data, error } = await supabase.rpc('admin_list_users_with_email');
  if (error) return { users: [], error: error.message };
  return { users: (data ?? []) as AdminUserRow[] };
}

export interface AdminIndividualRow {
  gedcom_id: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  birth_date: string | null;
  birth_place: string | null;
  death_date: string | null;
  death_place: string | null;
  notes: string | null;
}

export async function adminSearchIndividuals(
  query: string,
  limit = 30
): Promise<{ rows: AdminIndividualRow[]; error?: string }> {
  const { data, error } = await supabase.rpc('admin_search_individuals', {
    search_query: query,
    result_limit: limit,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as AdminIndividualRow[] };
}

export async function adminUpdateIndividual(
  gedcomId: string,
  fields: Record<string, string | null>
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_update_individual', {
    target_gedcom_id: gedcomId,
    fields,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function adminDeleteIndividual(gedcomId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_delete_individual', {
    target_gedcom_id: gedcomId,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function searchIndividualsServer(
  query: string,
  limit = 50
): Promise<{ rows: AdminIndividualRow[]; error?: string }> {
  const { data, error } = await supabase.rpc('search_individuals', {
    search_query: query,
    result_limit: limit,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as AdminIndividualRow[] };
}

export async function adminMergeIndividuals(
  keepGedcomId: string,
  mergeGedcomId: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_merge_individuals', {
    keep_gedcom_id: keepGedcomId,
    merge_gedcom_id: mergeGedcomId,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}
