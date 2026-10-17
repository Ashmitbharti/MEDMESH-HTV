import { forId } from '../link/meshLink';

// Turns the radio messages for one case into what the person needs to know right now.
//   A|id|OK                         received by the command centre
//   H|id|AMB|min|text               ambulance assigned           H|id|PK  paramedics have the patient
//   H|id|ARR|0|text                 arrived                      H|id|RR  hospital changed
//   AL|id|lat,lon|eta|hospID|P/H    where the ambulance is       CN|id|QUEUED/SENT|name  emergency contact
export function caseStatus(id, inbox, outbox) {
  const msgs = forId(inbox, id);
  const out = outbox.find((o) => o.id === id);
  const H = msgs.filter((m) => m.code === 'H');
  const has = (k) => H.some((m) => m.f[1] === k);
  const al = msgs.filter((m) => m.code === 'AL').pop();
  const cn = msgs.filter((m) => m.code === 'CN').pop();
  const assign = [...H].reverse().find((m) => m.f[1] === 'AMB' || m.f[1] === 'RR');
  let hospId = al?.f[3] || '';
  const hospName = (assign?.f.slice(3).join('|').match(/(?:to|going to) ([^.]+?)(?:\.|$)/) || [])[1] || '';
  const [lat, lon] = (al?.f[1] || '').split(',').map(Number);
  const phase = has('ARR') ? 'arrived' : has('PK') || al?.f[4] === 'H' ? 'withyou' : has('AMB') || al ? 'coming'
    : msgs.some((m) => m.code === 'A') || out?.status === 'acked' ? 'received' : out?.status === 'sent' ? 'sent' : 'saved';
  const etaAt = al ? { min: Number(al.f[2]), at: al.at } : assign ? { min: Number(assign.f[2]), at: assign.at } : null;
  const timeline = [
    out ? { at: out.at, text: 'Report saved on this phone' } : null,
    ...msgs.map((m) => {
      if (m.code === 'A') return { at: m.at, text: 'Received by the command centre ✓✓' };
      if (m.code === 'H') return { at: m.at, text: m.f.slice(3).join('|') };
      if (m.code === 'CN') return { at: m.at, text: m.f[1] === 'SENT' ? `${m.f[2]} has been texted` : `${m.f[2]} will be texted` };
      return null;
    }),
  ].filter(Boolean);
  return {
    phase, hospId, hospName, amb: al && !Number.isNaN(lat) ? { lat, lon } : null, ambPhase: al?.f[4] || 'P', etaAt,
    contact: cn ? { name: cn.f[2], sent: cn.f[1] === 'SENT' } : null, timeline,
  };
}

export function etaLeft(etaAt, now) {
  if (!etaAt || Number.isNaN(etaAt.min)) return null;
  return Math.max(0, Math.round(etaAt.min - (now - etaAt.at) / 60000));
}
