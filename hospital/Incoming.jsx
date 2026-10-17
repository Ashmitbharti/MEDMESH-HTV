import { useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ambulance, BedDouble, CircleCheck, Droplet, Hand, ShieldAlert, Siren, Square, SquareCheck, TriangleAlert } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useMesh } from '../link/meshLink';
import { newId } from '../dashboard/outbox';
import { useClock } from '../ui3d/project';
import ArrivalRings from './ArrivalRings';
import { useHospital } from './HospitalContext';
import { AGE, answer, COMPLAINT, incoming, loadFigures, PREPARE, saveFigures, scenes, TRIAGE } from './hospitalService';
import { ago } from './controls';

const PHASE = {
  coming: (p) => `Ambulance going to them · about ${p.pick} min, then ${p.drive} min to you`,
  enroute: () => 'In the ambulance, on the way to you',
  arrived: () => 'Arrived',
  away: () => 'Sent to another hospital (route changed)',
};

function PatientCard({ p, open, onOpen, outbox, checks, onCheck }) {
  const tri = TRIAGE[p.triage] || TRIAGE[2];
  const ha = outbox.find((o) => o.id === p.id && o.kind === 'hospital-ack');
  const away = p.phase === 'away';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Patient ${p.id}, ${tri.label}, ${COMPLAINT[p.complaint] || p.complaint}`} onPress={onOpen}
      style={{ marginTop: 12, borderRadius: 22, backgroundColor: c.panel, borderWidth: 1, borderColor: open ? tri.color : c.line, overflow: 'hidden', opacity: away ? 0.55 : 1 }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: tri.color }} />
      <View style={{ padding: 15, paddingLeft: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: tri.color + '26' }}>
                <Text style={{ color: tri.color, fontSize: 10.5, fontWeight: '900', letterSpacing: 1 }}>{tri.label.toUpperCase()}</Text>
              </View>
              <Text style={{ color: c.dim, fontSize: 11, fontFamily: mono }}>#{p.id}</Text>
            </View>
            <Text style={{ color: c.ink, fontSize: 17, fontWeight: '800', marginTop: 7 }}>{COMPLAINT[p.complaint] || p.complaint}</Text>
            <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 2 }}>{AGE[p.age] || p.age} · triage by the command centre</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: away ? c.dim : c.ink, fontSize: 30, fontWeight: '900', letterSpacing: -1 }}>{p.phase === 'arrived' ? 'Here' : away ? '—' : p.mins}</Text>
            {p.phase !== 'arrived' && !away ? <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', marginTop: -3 }}>MIN</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <Ambulance size={14} color={p.phase === 'enroute' ? tri.color : c.dim} />
          <Text style={{ color: c.muted, fontSize: 12.5, flex: 1 }}>{PHASE[p.phase](p)}</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: c.panel2 }}>
            <Droplet size={12} color={c.redl} /><Text style={{ color: c.ink, fontSize: 12, fontWeight: '700' }}>{p.blood ? `Blood ${p.blood}` : 'Blood group unknown'}</Text>
          </View>
          {p.allergies.map((a) => (
            <View key={a} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(244,63,94,0.16)', borderWidth: 1, borderColor: 'rgba(244,63,94,0.5)' }}>
              <TriangleAlert size={12} color="#fda4af" /><Text style={{ color: '#fecdd3', fontSize: 12, fontWeight: '800' }}>Allergy: {a}</Text>
            </View>
          ))}
        </View>
        {open && !away ? (
          <View style={{ marginTop: 14 }}>
            <Text style={{ color: c.sky, fontFamily: mono, fontSize: 10, letterSpacing: 1.6, fontWeight: '700', marginBottom: 6 }}>GET READY · YOUR PROTOCOLS APPLY</Text>
            {(PREPARE[p.complaint] || PREPARE.OT).map((step) => {
              const on = !!checks[`${p.id}:${step}`];
              const I = on ? SquareCheck : Square;
              return (
                <Pressable key={step} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={step} onPress={() => onCheck(`${p.id}:${step}`)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7 }}>
                  <I size={18} color={on ? c.green : c.muted} />
                  <Text style={{ color: on ? c.muted : c.ink, fontSize: 14, fontWeight: '600', textDecorationLine: on ? 'line-through' : 'none' }}>{step}</Text>
                </Pressable>
              );
            })}
            <Pressable accessibilityRole="button" disabled={!!ha} onPress={() => answer(p.id, 'READY')}
              style={({ pressed }) => [{ marginTop: 10, minHeight: 50, borderRadius: 16, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: ha ? 'rgba(52,211,153,0.14)' : c.blue6, borderWidth: ha ? 1 : 0, borderColor: 'rgba(52,211,153,0.5)' }, pressed && { opacity: 0.85 }]}>
              {ha ? <CircleCheck size={17} color={c.green} /> : <Hand size={17} color="#fff" />}
              <Text style={{ color: ha ? '#bbf7d0' : '#fff', fontSize: 15, fontWeight: '800' }}>
                {ha ? (ha.status === 'acked' ? 'Command centre told: you are ready' : 'Sending “ready”…') : 'We are ready for this patient'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function Incoming() {
  const { width } = useWindowDimensions();
  const { hospital } = useHospital();
  const { inbox, outbox } = useMesh();
  const { now } = useClock(true, 1);
  const [sel, setSel] = useState(null);
  const [checks, setChecks] = useState({});
  const [confirmFull, setConfirmFull] = useState(false);
  const [fullAt, setFullAt] = useState(0);

  const list = incoming(inbox, now);
  const active = list.filter((p) => p.phase !== 'away');
  const scene = scenes(inbox).find((z) => now - z.at < 60 * 60000);
  const counts = [1, 2, 3, 4].map((k) => ({ k, n: active.filter((p) => p.triage === k && p.phase !== 'arrived').length })).filter((x) => x.n || x.k < 4);
  const next = active.filter((p) => p.phase !== 'arrived').sort((a, b) => a.arriveAt - b.arriveAt)[0];
  const open = sel || active.find((p) => p.triage === 1 && p.phase !== 'arrived')?.id;

  async function full() {
    await answer(newId(), 'FULL');
    if (hospital) { const f = await loadFigures(hospital.id); await saveFigures(hospital.id, { ...f, status: 'divert' }); }
    setFullAt(Date.now());
    setConfirmFull(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <LinearGradient colors={['rgba(244,63,94,0.2)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 340 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fda4af', fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>INCOMING · {(hospital?.short || '').toUpperCase()}</Text>
            <Text style={{ color: c.ink, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 }}>Who’s coming,{'\n'}and when.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="We're full" onPress={() => setConfirmFull((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(251,191,36,0.5)', backgroundColor: 'rgba(251,191,36,0.1)' }}>
            <BedDouble size={15} color={c.amber} /><Text style={{ color: '#fde68a', fontSize: 13, fontWeight: '800' }}>We’re full</Text>
          </Pressable>
        </View>
        {confirmFull ? (
          <View style={{ marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.5)' }}>
            <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>New patients will be sent to other hospitals and ambulances not yet near you are re-routed. Patients already close still come here.</Text>
            <Pressable accessibilityRole="button" onPress={full} style={{ marginTop: 10, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.amber }}>
              <Text style={{ color: '#1c1917', fontSize: 14.5, fontWeight: '900' }}>Yes, divert new patients</Text>
            </Pressable>
          </View>
        ) : null}
        {fullAt ? <Text style={{ color: '#fde68a', fontSize: 12.5, marginTop: 10 }}>Diverting since {ago(fullAt, now)}. Re-open on the Hospital tab when you have room.</Text> : null}

        {scene ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, padding: 13, borderRadius: 18, backgroundColor: 'rgba(244,63,94,0.12)', borderWidth: 1, borderColor: 'rgba(244,63,94,0.5)' }}>
            <Siren size={18} color="#fb7185" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fecdd3', fontSize: 14, fontWeight: '800' }}>Scene: {scene.count} people hurt{scene.cause ? ` · ${scene.cause.toLowerCase()}` : ''}</Text>
              <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 2 }}>
                Reported {ago(scene.at, now)}.{scene.hazards.length ? ` Danger at scene: ${scene.hazards.join(', ').toLowerCase()}.` : ''} More patients may follow.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          {counts.map(({ k, n }) => (
            <View key={k} style={{ flex: 1, padding: 10, borderRadius: 16, backgroundColor: c.panel, borderWidth: 1, borderColor: n ? TRIAGE[k].color + '66' : c.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: TRIAGE[k].color }} />
                <Text style={{ color: c.muted, fontSize: 10.5, fontWeight: '800' }}>{TRIAGE[k].label.toUpperCase()}</Text>
              </View>
              <Text style={{ color: c.ink, fontSize: 24, fontWeight: '900', marginTop: 2 }}>{n}</Text>
            </View>
          ))}
        </View>
        <Text style={{ color: c.muted, fontSize: 13, marginTop: 10 }}>
          {next ? `Next arrival in ${next.mins} min · ${TRIAGE[next.triage]?.label.toLowerCase()} · ${COMPLAINT[next.complaint]?.toLowerCase() || ''}` : 'Nobody is on the way to you right now.'}
        </Text>

        <View style={{ marginHorizontal: -10, marginTop: 4 }}>
          <ArrivalRings width={width - 20} patients={list} selected={open} onSelect={setSel} />
        </View>

        {!list.length ? (
          <View style={{ padding: 18, borderRadius: 20, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, alignItems: 'center' }}>
            <ShieldAlert size={22} color={c.dim} />
            <Text style={{ color: c.muted, fontSize: 13.5, textAlign: 'center', marginTop: 8, lineHeight: 19 }}>
              When the command centre sends a patient here, they appear on the rings and below, with their triage, ETA, blood group and allergies.
            </Text>
          </View>
        ) : null}
        {list.map((p) => (
          <PatientCard key={p.id} p={p} open={open === p.id} onOpen={() => setSel(p.id)} outbox={outbox} checks={checks}
            onCheck={(k) => setChecks((x) => ({ ...x, [k]: !x[k] }))} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
