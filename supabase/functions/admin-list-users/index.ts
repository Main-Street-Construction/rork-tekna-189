import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const callerClient = createClient(supabaseUrl, anonKey || serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData.user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerProfile, error: profileErr } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', callerData.user.id)
      .maybeSingle();

    if (profileErr || !callerProfile?.is_admin) return json({ error: 'Forbidden' }, 403);

    const { data: profiles, error: profilesErr } = await admin
      .from('profiles')
      .select('id, full_name, is_enabled, is_admin, created_at, claimed_gedcom_id')
      .order('created_at', { ascending: false });

    if (profilesErr) return json({ error: profilesErr.message }, 500);

    const authById = new Map<string, {
      email?: string;
      email_confirmed_at?: string | null;
      last_sign_in_at?: string | null;
      created_at?: string;
      user_metadata?: Record<string, unknown>;
    }>();

    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return json({ error: error.message }, 500);
      const batch = data.users ?? [];
      for (const user of batch) authById.set(user.id, user);
      if (batch.length < 200) break;
    }

    const gedcomIds = [...new Set(
      (profiles ?? [])
        .map((row) => row.claimed_gedcom_id as string | null)
        .filter((id): id is string => !!id)
    )];

    const claimedNames = new Map<string, string>();
    if (gedcomIds.length > 0) {
      const { data: people } = await admin
        .from('individuals')
        .select('gedcom_id, first_name, last_name')
        .in('gedcom_id', gedcomIds);

      for (const person of people ?? []) {
        const name = [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
        if (name) claimedNames.set(person.gedcom_id as string, name);
      }
    }

    const backfills: Array<{ id: string; full_name: string }> = [];

    const users = (profiles ?? []).map((row) => {
      const authUser = authById.get(row.id as string);
      const fromProfile = typeof row.full_name === 'string' ? row.full_name.trim() : '';
      const fromMeta = metaName(authUser?.user_metadata);
      const fullName = fromProfile || fromMeta || null;
      if (!fromProfile && fromMeta) {
        backfills.push({ id: row.id as string, full_name: fromMeta });
      }

      const claimedId = (row.claimed_gedcom_id as string | null) ?? null;
      return {
        id: row.id,
        email: authUser?.email ?? null,
        full_name: fullName,
        is_enabled: row.is_enabled,
        is_admin: row.is_admin,
        created_at: row.created_at ?? authUser?.created_at ?? null,
        email_confirmed: !!authUser?.email_confirmed_at,
        last_sign_in_at: authUser?.last_sign_in_at ?? null,
        claimed_gedcom_id: claimedId,
        claimed_person_name: claimedId ? claimedNames.get(claimedId) ?? null : null,
      };
    });

    await Promise.all(backfills.map(async (row) => {
      const { error } = await admin.from('profiles').update({
        full_name: row.full_name,
      }).eq('id', row.id).is('full_name', null);
      if (error) console.warn('name backfill failed', row.id, error.message);
    }));

    return json({ users });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
