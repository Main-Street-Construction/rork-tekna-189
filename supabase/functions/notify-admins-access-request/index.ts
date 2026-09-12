import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotifyRequest {
  user_id: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase env' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as NotifyRequest;
    const userId = body?.user_id;

    if (!userId) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: shouldNotify, error: shouldErr } = await supabase.rpc(
      'should_notify_access_request',
      { target_user_id: userId }
    );

    if (shouldErr) {
      return new Response(JSON.stringify({ error: shouldErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!shouldNotify) {
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: payload, error: payloadErr } = await supabase.rpc(
      'get_access_request_notification_payload',
      { target_user_id: userId }
    );

    if (payloadErr || !payload) {
      return new Response(JSON.stringify({ error: payloadErr?.message ?? 'No payload' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const info = payload as { user_id: string; email: string; full_name: string };

    const { data: tokens, error: tokensErr } = await supabase.rpc('get_admin_push_targets');

    if (tokensErr) {
      return new Response(JSON.stringify({ error: tokensErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pushTokens = (tokens ?? []) as Array<{ expo_push_token: string }>;

    if (pushTokens.length === 0) {
      // Do not mark notified — retry when an admin registers a token
      return new Response(JSON.stringify({ success: true, sent: 0, reason: 'no_admin_tokens' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const messages = pushTokens.map((t) => ({
      to: t.expo_push_token,
      sound: 'default',
      title: 'New access request',
      body: `${info.full_name} (${info.email}) is waiting for approval`,
      data: { type: 'access_request', user_id: info.user_id },
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
      const errText = await pushRes.text();
      return new Response(JSON.stringify({ error: errText }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.rpc('mark_access_notified', { target_user_id: userId });

    return new Response(
      JSON.stringify({ success: true, sent: messages.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});