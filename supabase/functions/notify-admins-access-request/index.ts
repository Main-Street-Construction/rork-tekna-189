import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotifyRequest {
  user_id?: string;
  flush_pending?: boolean;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  is_enabled: boolean;
  is_admin: boolean;
  access_notified_at: string | null;
  access_requested_at: string | null;
  created_at: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function metaName(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  const full = metadata.full_name;
  if (typeof full === 'string' && full.trim()) return full.trim();
  const first = typeof metadata.first_name === 'string' ? metadata.first_name.trim() : '';
  const last = typeof metadata.last_name === 'string' ? metadata.last_name.trim() : '';
  const combined = [first, last].filter(Boolean).join(' ');
  return combined || null;
}

async function resolveIdentity(
  admin: SupabaseClient,
  userId: string,
  profileName: string | null
): Promise<{ email: string; fullName: string; storedName: string | null }> {
  let email = 'unknown';
  let storedName = profileName?.trim() || null;

  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) {
    return { email, fullName: storedName || 'New user', storedName };
  }

  if (data.user.email) email = data.user.email;
  const fromMeta = metaName(data.user.user_metadata as Record<string, unknown> | undefined);
  if (!storedName && fromMeta) storedName = fromMeta;

  return { email, fullName: storedName || 'New user', storedName };
}

async function persistName(
  admin: SupabaseClient,
  userId: string,
  profile: ProfileRow | null,
  storedName: string | null
) {
  if (!storedName) return;
  const now = new Date().toISOString();

  if (!profile) {
    await admin.from('profiles').insert({
      id: userId,
      is_enabled: false,
      is_admin: false,
      full_name: storedName,
      access_requested_at: now,
    });
    return;
  }

  if (profile.full_name?.trim()) {
    if (!profile.access_requested_at && !profile.is_enabled) {
      await admin.from('profiles').update({ access_requested_at: now }).eq('id', userId);
    }
    return;
  }

  await admin.from('profiles').update({
    full_name: storedName,
    access_requested_at: profile.access_requested_at ?? now,
  }).eq('id', userId);
}

async function loadAdminTokens(admin: SupabaseClient): Promise<string[]> {
  const { data: admins, error: adminErr } = await admin
    .from('profiles')
    .select('id')
    .eq('is_admin', true);

  if (adminErr) throw new Error(adminErr.message);
  const ids = (admins ?? []).map((row) => row.id as string);
  if (ids.length === 0) return [];

  const { data: tokens, error: tokenErr } = await admin
    .from('push_tokens')
    .select('expo_push_token')
    .in('user_id', ids);

  if (tokenErr) throw new Error(tokenErr.message);

  return [...new Set((tokens ?? []).map((row) => row.expo_push_token as string).filter(Boolean))];
}

async function sendPush(
  admin: SupabaseClient,
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<{ sent: number; failed: number }> {
  const messages = tokens.map((to) => ({
    to,
    sound: 'default',
    title,
    body,
    data,
    priority: 'high',
    channelId: 'default',
  }));

  const pushRes = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(messages),
  });

  if (!pushRes.ok) {
    throw new Error(await pushRes.text());
  }

  const payload = await pushRes.json() as {
    data?: Array<{ status?: string; details?: { error?: string }; message?: string }>;
  };
  const tickets = payload.data ?? [];
  const deadTokens: string[] = [];
  let failed = 0;

  tickets.forEach((ticket, index) => {
    if (ticket.status === 'error') {
      failed += 1;
      if (ticket.details?.error === 'DeviceNotRegistered') {
        deadTokens.push(tokens[index]);
      }
    }
  });

  if (deadTokens.length > 0) {
    await admin.from('push_tokens').delete().in('expo_push_token', deadTokens);
  }

  const sent = tickets.length === 0 ? messages.length : tickets.length - failed;
  if (sent <= 0) {
    throw new Error(tickets.find((t) => t.message)?.message ?? 'Expo push rejected all tokens');
  }

  return { sent, failed };
}

function recentlyNotified(accessNotifiedAt: string | null): boolean {
  if (!accessNotifiedAt) return false;
  return Date.now() - new Date(accessNotifiedAt).getTime() < 5 * 60 * 1000;
}

async function notifyOne(
  admin: SupabaseClient,
  userId: string,
  tokens: string[]
): Promise<{ sent: number; skipped?: string }> {
  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, is_enabled, is_admin, access_notified_at, access_requested_at, created_at')
    .eq('id', userId)
    .maybeSingle();

  const row = (profile ?? null) as ProfileRow | null;
  if (row?.is_enabled) return { sent: 0, skipped: 'already_enabled' };
  if (row && recentlyNotified(row.access_notified_at)) return { sent: 0, skipped: 'recently_notified' };

  const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
  if (authErr || !authUser.user) return { sent: 0, skipped: 'user_not_found' };

  const identity = await resolveIdentity(admin, userId, row?.full_name ?? null);
  await persistName(admin, userId, row, identity.storedName);

  if (tokens.length === 0) return { sent: 0, skipped: 'no_admin_tokens' };

  const result = await sendPush(
    admin,
    tokens,
    'New access request',
    `${identity.fullName} (${identity.email}) is waiting for approval`,
    { type: 'access_request', user_id: userId }
  );

  await admin.from('profiles').update({ access_notified_at: new Date().toISOString() }).eq('id', userId);
  return result;
}

async function callerIsAdmin(
  admin: SupabaseClient,
  supabaseUrl: string,
  anonKey: string,
  authHeader: string | null
): Promise<boolean> {
  if (!authHeader) return false;
  const callerClient = createClient(supabaseUrl, anonKey || '', {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await callerClient.auth.getUser();
  if (error || !data.user) return false;

  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', data.user.id)
    .maybeSingle();

  return profile?.is_admin === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Missing Supabase env' }, 500);
    }

    const body = (await req.json().catch(() => ({}))) as NotifyRequest;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (body.flush_pending) {
      const allowed = await callerIsAdmin(admin, supabaseUrl, anonKey, req.headers.get('Authorization'));
      if (!allowed) return json({ error: 'Forbidden' }, 403);

      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: pending, error: pendingErr } = await admin
        .from('profiles')
        .select('id, created_at, access_requested_at, access_notified_at, is_enabled')
        .eq('is_enabled', false)
        .is('access_notified_at', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (pendingErr) return json({ error: pendingErr.message }, 500);

      const tokens = await loadAdminTokens(admin);
      let sent = 0;
      let skipped = 0;
      for (const row of pending ?? []) {
        const recent = (row.created_at && row.created_at >= since) || !!row.access_requested_at;
        if (!recent) {
          skipped += 1;
          continue;
        }
        const result = await notifyOne(admin, row.id as string, tokens);
        sent += result.sent;
        if (result.skipped) skipped += 1;
      }

      return json({
        success: true,
        flushed: true,
        sent,
        skipped,
        reason: tokens.length === 0 ? 'no_admin_tokens' : undefined,
      });
    }

    const userId = body.user_id;
    if (!userId) return json({ error: 'user_id required' }, 400);

    let tokens: string[] = [];
    let tokenError: string | undefined;
    try {
      tokens = await loadAdminTokens(admin);
    } catch (e) {
      tokenError = e instanceof Error ? e.message : String(e);
    }

    const result = await notifyOne(admin, userId, tokens);
    return json({
      success: true,
      sent: result.sent,
      skipped: result.skipped ?? false,
      reason: result.skipped ?? tokenError,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
