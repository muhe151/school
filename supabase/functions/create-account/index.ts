import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');
  if (!url || !publishableKey || !serviceKey || !authHeader) return respond({ error: 'Server configuration or sign-in is missing.' }, 401);

  const callerClient = createClient(url, publishableKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: authError } = await callerClient.auth.getUser();
  if (authError || !userData.user) return respond({ error: 'Sign-in is required.' }, 401);

  const { data: caller, error: callerError } = await adminClient.from('profiles')
    .select('id,role,status').eq('id', userData.user.id).maybeSingle();
  if (callerError || !caller || caller.status !== 'Active' || !['admin', 'registrar'].includes(caller.role)) {
    return respond({ error: 'Only an active administrator or registrar can create school accounts.' }, 403);
  }

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return respond({ error: 'Invalid JSON request.' }, 400); }
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const fullName = String(input.full_name || '').trim();
  const role = String(input.role || 'student');
  const status = String(input.status || 'Pending');
  if (!email || !password || password.length < 8 || !fullName) {
    return respond({ error: 'Full name, valid email, and a password of at least 8 characters are required.' }, 400);
  }
  if (!['student', 'teacher', 'registrar', 'admin'].includes(role)) return respond({ error: 'Invalid account role.' }, 400);
  if (caller.role !== 'admin' && role !== 'student') return respond({ error: 'Only an administrator may create staff accounts.' }, 403);
  if (!['Pending', 'Active'].includes(status)) return respond({ error: 'Invalid account status.' }, 400);

  const metadata = {
    full_name: fullName,
    grade: typeof input.grade === 'string' && input.grade !== '—' ? input.grade : null,
    guardian: typeof input.guardian === 'string' ? input.guardian : null,
    phone: typeof input.phone === 'string' ? input.phone : null,
  };
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: metadata,
  });
  if (createError || !created.user) return respond({ error: createError?.message || 'Account could not be created.' }, 400);

  const profileUpdate = {
    full_name: fullName, role, status,
    grade: metadata.grade, guardian: metadata.guardian, phone: metadata.phone,
    room: typeof input.room === 'string' ? input.room : null,
    subject: typeof input.subject === 'string' && input.subject !== '—' ? input.subject : null,
    date_of_birth: typeof input.dob === 'string' && input.dob ? input.dob : null,
    home_address: typeof input.address === 'string' ? input.address : null,
    emergency_contact: typeof input.emergency === 'string' ? input.emergency : null,
  };
  const { error: profileError } = await adminClient.from('profiles').update(profileUpdate).eq('id', created.user.id);
  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id);
    return respond({ error: `The auth account was rolled back because its school profile could not be saved: ${profileError.message}` }, 500);
  }
  return respond({ id: created.user.id, email, full_name: fullName, role, status }, 201);
});
