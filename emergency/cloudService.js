import { getSession, getSupabase } from '../lib/supabase';

export async function submitEmergency(request) {
  await getSession();
  const { data, error } = await getSupabase().rpc('submit_emergency_request', { p_payload: {
    id: request.id,
    revision: request.revision || 1,
    mode: request.mode,
    medmeshId: request.medmeshId,
    phase: request.phase,
    coordinates: request.coordinates || null,
    answers: request.answers,
    missedQuestions: request.missedQuestions,
    escalation: request.escalation,
    conditionUpdates: request.conditionUpdates || [],
  } });
  if (error) throw new Error(['PGRST202', '42P01', 'PGRST205'].includes(error.code)
    ? 'Run the SOS routing SQL in Supabase, then retry.' : error.message);
  if (!data?.id) throw new Error('No Command Center acknowledgment returned.');
  return data;
}

export async function staffEmergencies(mode, hospitalId) {
  if (mode === 'hospital' && !/^MMH-[A-Z0-9]{3,8}$/.test(hospitalId || '')) throw new Error('Invalid hospital ID.');
  const session = await getSession();
  const { data: operator, error: accessError } = await getSupabase().from('command_operators')
    .select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (accessError) throw new Error('Run the SOS routing SQL in Supabase to create staff access and SOS tables.');
  let permitted = !!operator;
  if (!permitted && mode === 'hospital') {
    const { data, error } = await getSupabase().from('hospital_staff').select('hosid')
      .eq('user_id', session.user.id).eq('hosid', hospitalId).maybeSingle();
    if (error) throw error;
    permitted = !!data;
  }
  if (!permitted) {
    const sql = mode === 'command'
      ? `insert into public.command_operators (user_id) values ('${session.user.id}') on conflict do nothing;`
      : `insert into public.hospital_staff (user_id, hosid) values ('${session.user.id}', '${hospitalId}') on conflict do nothing;`;
    return { requests: [], setupSql: sql, message: 'This account needs SOS staff access. Run this once in your Supabase SQL Editor, then refresh.' };
  }
  let query = getSupabase().from('emergency_requests').select('*');
  if (mode === 'hospital') query = query.eq('hospital_id', hospitalId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return { requests: data, setupSql: '', message: 'Supabase connected · checking every 10 seconds while this screen is active.' };
}

export async function emergencyAction(request, action, details = {}) {
  await getSession();
  const { data, error } = await getSupabase().rpc('operate_demo_emergency', {
    p_id: request.id,
    p_action: action,
    p_details: { ...details, version: request.operation_version },
  });
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error('No operation acknowledgment returned.');
  return data;
}
