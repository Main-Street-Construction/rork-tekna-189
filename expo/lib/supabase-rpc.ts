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
    const { data, error } = await supabase.functions.invoke('notify-admins-access-request', {
      body: { user_id: userId },
    });
    if (error) {
      console.warn('[RPC] notify-admins-access-request failed:', error.message);
      return;
    }
    console.log('[RPC] notify-admins-access-request:', data);
  } catch (e) {
    console.warn('[RPC] notify-admins-access-request error:', e);
  }
}

export async function flushPendingAccessNotifications(): Promise<void> {
  try {
    const { data, error } = await supabase.functions.invoke('notify-admins-access-request', {
      body: { flush_pending: true },
    });
    if (error) {
      console.warn('[RPC] flush pending access notifications failed:', error.message);
      return;
    }
    console.log('[RPC] flush pending access notifications:', data);
  } catch (e) {
    console.warn('[RPC] flush pending access notifications error:', e);
  }
}

/** Self-service account deletion (App Store Guideline 5.1.1). */
export async function deleteMyAccount(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('delete-my-account', {
      body: {},
    });
    if (!error && data && typeof data === 'object' && (data as { success?: boolean }).success) {
      return { success: true };
    }
    const message =
      error?.message ||
      (data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : 'Failed to delete account');
    return { success: false, error: message };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function adminDeleteUser(targetUserId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('admin-delete-user', {
      body: { user_id: targetUserId },
    });

    if (!error && data && typeof data === 'object' && (data as { success?: boolean }).success) {
      return { success: true };
    }

    const edgeMessage =
      error?.message ||
      (data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : null);

    // Fallback to RPC if edge function is unavailable
    const { data: rpcData, error: rpcError } = await supabase.rpc('admin_delete_user', {
      target_user_id: targetUserId,
    });
    if (rpcError) {
      return { success: false, error: edgeMessage ?? rpcError.message };
    }
    const result = rpcData as { success: boolean; error?: string };
    if (!result.success) {
      return { success: false, error: result.error ?? edgeMessage ?? 'Delete failed' };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
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

export async function updateProfileDisplayName(
  displayName: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('update_profile_display_name', {
    display_name: displayName,
  });
  if (error) {
    // Fallback for projects that have not applied v8 yet
    const fallback = await setProfileFullName(displayName);
    return fallback.success ? { success: true } : { success: false, error: error.message };
  }
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function getNextGedcomId(
  prefix: 'I' | 'F'
): Promise<{ success: boolean; gedcomId?: string; error?: string }> {
  const { data, error } = await supabase.rpc('get_next_gedcom_id', {
    id_prefix: prefix,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; gedcom_id?: string; error?: string };
  if (!result.success || !result.gedcom_id) {
    return { success: false, error: result.error ?? 'Failed to allocate ID' };
  }
  return { success: true, gedcomId: result.gedcom_id };
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
  try {
    const { data, error } = await supabase.functions.invoke('admin-list-users', { body: {} });
    const users = data && typeof data === 'object' && 'users' in data
      ? (data as { users?: AdminUserRow[] }).users
      : undefined;
    if (!error && Array.isArray(users)) {
      return { users };
    }
  } catch (e) {
    console.warn('[RPC] admin-list-users failed, falling back to RPC:', e);
  }

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
): Promise<{ success: boolean; error?: string; familiesCollapsed?: number }> {
  const { data, error } = await supabase.rpc('admin_merge_individuals', {
    keep_gedcom_id: keepGedcomId,
    merge_gedcom_id: mergeGedcomId,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string; families_collapsed?: number };
  if (!result.success) return { success: false, error: result.error };
  return { success: true, familiesCollapsed: result.families_collapsed ?? 0 };
}

export async function adminMergeFamilies(
  keepGedcomId: string,
  mergeGedcomId: string
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_merge_families', {
    keep_gedcom_id: keepGedcomId,
    merge_gedcom_id: mergeGedcomId,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function adminDeleteFamily(gedcomId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_delete_family', {
    target_gedcom_id: gedcomId,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function adminUpdateFamily(params: {
  gedcomId: string;
  husbandGedcomId?: string | null;
  wifeGedcomId?: string | null;
  marriageDate?: string | null;
  marriagePlace?: string | null;
  clearHusband?: boolean;
  clearWife?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('admin_update_family', {
    target_gedcom_id: params.gedcomId,
    set_husband_gedcom_id: params.husbandGedcomId ?? null,
    set_wife_gedcom_id: params.wifeGedcomId ?? null,
    set_marriage_date: params.marriageDate ?? null,
    set_marriage_place: params.marriagePlace ?? null,
    clear_husband: params.clearHusband ?? false,
    clear_wife: params.clearWife ?? false,
  });
  if (error) return { success: false, error: error.message };
  const result = data as { success: boolean; error?: string };
  return result.success ? { success: true } : { success: false, error: result.error };
}
