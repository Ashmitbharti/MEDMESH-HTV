import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import WeatherBackdrop from '../dashboard/WeatherBackdrop';
import { useHazard } from '../dashboard/hazardService';
import { router } from 'expo-router';
import { Building2, CircleCheck, Clock, FlaskConical, LogOut, Radio, Send, Stethoscope, TriangleAlert } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useAuth } from '../auth/AuthContext';
import { useMesh } from '../link/meshLink';
import { useClock } from '../ui3d/project';
import LinkBanner from '../components/LinkBanner';
import HospitalTower, { FLOORS } from './HospitalTower';
import { useHospital } from './HospitalContext';
import { ago, Card, Chip, Dropdown, Label, Stepper } from './controls';
import { ascii, CAPS, HOSPITALS, loadFigures, NOTES, sendFigures, STATUS, updateAcked, WAITS } from './hospitalService';

const same = (a, b) => ['status', 'total', 'free', 'icuTotal', 'icu', 'erSpaces', 'wait', 'caps', 'note'].every((k) => a?.[k] === b?.[k]);

function Picker({ choose }) {
  return (
    <Card>
      <Label>WHICH HOSPITAL IS THIS?</Label>
      <Text style={{ color: c.muted, fontSize: 13.5, marginBottom: 10 }}>Pick it once. Patients for this hospital will arrive on this device.</Text>
      {HOSPITALS.map((h) => (
        <Pressable key={h.id} accessibilityRole="button" onPress={() => choose(h.id)} style={{ padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.line2, marginTop: 8 }}>
          <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: '700' }}>{h.name}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

export default function HospitalHome() {
  const hz = useHazard();
  const { width } = useWindowDimensions();
  const { account, signOut } = useAuth();
  const { hospital, ready, choose } = useHospital();
  const { link, inbox } = useMesh();
  const { now } = useClock(true, 1);
  const [sent, setSent] = useState(null);
  const [fig, setFig] = useState(null);
  const [focus, setFocus] = useState('ward');
  const [pulseAt, setPulseAt] = useState(0);

  useEffect(() => {
    if (!hospital) return;
    loadFigures(hospital.id).then((f) => { setSent(f); setFig(f); });
  }, [hospital]);

  const set = (k, v) => setFig((f) => {
    const n = { ...f, [k]: v };
    if (k === 'total') n.free = Math.min(n.free, v);
    if (k === 'icuTotal') n.icu = Math.min(n.icu, v);
    return n;
  });
  const toggleCap = (k) => set('caps', fig.caps.includes(k) ? fig.caps.replace(k, '') : CAPS.map((x) => x.k).filter((x) => x === k || fig.caps.includes(x)).join(''));

  async function send() {
    const at = await sendFigures(hospital.id, fig);
    setSent({ ...fig, sentAt: at });
    setFig((f) => ({ ...f, sentAt: at }));
    setPulseAt(Date.now());
  }

  if (!ready) return null;
  const dirty = fig && sent && (!same(fig, sent) || !sent.sentAt);
  const acked = sent && updateAcked(inbox, sent.sentAt);
  const age = sent?.sentAt ? (now - sent.sentAt) / 60000 : Infinity;
  // The command centre forecasts beds between updates and its uncertainty grows with time; it plans with
  // (expected free beds - 1 standard deviation), so an old update counts for fewer beds than a fresh one.
  const fresh = age < 10 ? { tint: c.green, text: 'Fresh. Routing uses your numbers as reported.' }
    : age < 45 ? { tint: c.amber, text: 'Ageing. Routing is less sure, so it counts fewer of your free beds.' }
      : { tint: '#f43f5e', text: sent?.sentAt ? 'Stale. Routing is mostly guessing. Send an update.' : 'Not sent from here yet. Routing is using older figures.' };
  const wire = fig ? `C|${hospital?.id}|${fig.free}|${fig.icu}|${fig.caps}|${fig.status === 'open' ? 1 : 0}|${fig.wait}|${ascii(fig.note).slice(0, 40)}` : '';
  const st = fig ? STATUS[fig.status] : STATUS.open;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <WeatherBackdrop kind={hz.kind} />
      <LinearGradient colors={[st.tint + '30', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 380 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(252,165,165,0.15)' }}>
            <Building2 size={20} color={c.redl} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.redl, fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>HOSPITAL ACCOUNT</Text>
            <Text style={{ color: c.ink, fontSize: 17, fontWeight: '800' }} numberOfLines={1}>{hospital?.name || account?.name}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open the test kit" onPress={() => router.push('/testkit')}
            style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }}>
            <FlaskConical size={17} color={c.amber} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={async () => { await signOut(); router.replace('/welcome'); }}
            style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }}>
            <LogOut size={17} color={c.muted} />
          </Pressable>
        </View>

        {!hospital ? <Picker choose={choose} /> : !fig ? null : (
          <>
            <Text style={{ color: c.ink, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, marginTop: 16 }}>Your hospital, as the{'\n'}command centre sees it.</Text>
            <LinkBanner link={link} />

            <View style={{ marginTop: 10, marginHorizontal: -10 }}>
              <HospitalTower width={width - 20} fig={fig} focus={focus} onFloor={setFocus} pulseAt={pulseAt} />
            </View>
            <Text style={{ color: c.dim, fontSize: 11.5, textAlign: 'center', marginTop: -4 }}>Drag to turn · tap a floor · glowing cubes are free beds</Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 12, borderRadius: 18, backgroundColor: fresh.tint + '14', borderWidth: 1, borderColor: fresh.tint + '55' }}>
              {acked && age < 10 ? <CircleCheck size={18} color={fresh.tint} /> : age < 45 ? <Clock size={18} color={fresh.tint} /> : <TriangleAlert size={18} color={fresh.tint} />}
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontSize: 14, fontWeight: '800' }}>
                  Last update {ago(sent?.sentAt, now)}{sent?.sentAt ? (acked ? ' · received ✓✓' : ' · sending…') : ''}
                </Text>
                <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 17 }}>{fresh.text}</Text>
              </View>
            </View>

            <Card tint={st.tint} active>
              <Label tint={st.tint}>STATUS</Label>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {Object.entries(STATUS).map(([k, v]) => {
                  const on = fig.status === k;
                  return (
                    <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={v.label} onPress={() => set('status', k)}
                      style={{ flex: 1, padding: 11, borderRadius: 16, borderWidth: 1, borderColor: on ? v.tint : c.line2, backgroundColor: on ? v.tint + '22' : 'transparent', transform: [{ perspective: 400 }, { rotateX: on ? '0deg' : '14deg' }] }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: v.tint, opacity: on ? 1 : 0.4 }} />
                      <Text style={{ color: c.ink, fontSize: 14, fontWeight: '800', marginTop: 8 }}>{v.label}</Text>
                      <Text style={{ color: c.dim, fontSize: 11, lineHeight: 14, marginTop: 2 }}>{v.sub}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              {FLOORS.slice().reverse().map((f) => (
                <Chip key={f.key} on={focus === f.key} label={f.label} tint={f.tint} onPress={() => setFocus(f.key)} />
              ))}
            </View>

            {focus === 'ward' ? (
              <Card tint={FLOORS[1].tint} active>
                <Label tint={FLOORS[1].tint}>INPATIENT BEDS</Label>
                <Stepper label="Beds in total" value={fig.total} onChange={(v) => set('total', v)} tint={FLOORS[1].tint} />
                <Stepper label="Free right now" sub="Staffed and ready" value={fig.free} max={fig.total} onChange={(v) => set('free', v)} tint={FLOORS[1].tint} />
              </Card>
            ) : null}
            {focus === 'icu' ? (
              <Card tint={FLOORS[2].tint} active>
                <Label tint={FLOORS[2].tint}>INTENSIVE CARE</Label>
                <Stepper label="ICU beds in total" value={fig.icuTotal} onChange={(v) => set('icuTotal', v)} tint={FLOORS[2].tint} />
                <Stepper label="ICU beds free" sub="With a ventilator if needed" value={fig.icu} max={fig.icuTotal} onChange={(v) => set('icu', v)} tint={FLOORS[2].tint} />
              </Card>
            ) : null}
            {focus === 'er' ? (
              <Card tint={FLOORS[0].tint} active>
                <Label tint={FLOORS[0].tint}>EMERGENCY DEPARTMENT</Label>
                <Stepper label="Treatment bays" value={fig.erSpaces} onChange={(v) => set('erSpaces', v)} tint={FLOORS[0].tint} />
                <Dropdown label="Wait to be seen" tint={FLOORS[0].tint} value={fig.wait} onChange={(v) => set('wait', v)}
                  options={WAITS.map((w) => ({ label: w.label, value: w.min }))} customLabel="Custom (minutes)…" customPlaceholder="Minutes, e.g. 75" keyboardType="number-pad" format={(v) => `About ${v} min`} />
                <Text style={{ color: c.dim, fontSize: 12, marginTop: 6 }}>Sent as {fig.wait} minutes.</Text>
              </Card>
            ) : null}

            <Card>
              <Label>WHAT YOU CAN TREAT</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {CAPS.map((k) => <Chip key={k.k} on={fig.caps.includes(k.k)} label={k.label} onPress={() => toggleCap(k.k)} />)}
              </View>
              <Dropdown label="Note for the command centre (optional)" value={fig.note} onChange={(v) => set('note', v.slice(0, 40))} allowNone
                options={NOTES.map((n) => ({ label: n, value: n }))} placeholder="No note" customLabel="Write your own…" customPlaceholder="Up to 40 letters, e.g. Neuro on call" />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
                <Stethoscope size={13} color={c.dim} />
                <Text style={{ color: c.dim, fontSize: 12, flex: 1 }}>Another specialty? Write it as a note. Routing reads the list above; staff read the note.</Text>
              </View>
            </Card>

            <Pressable accessibilityRole="button" onPress={send} disabled={!dirty} style={({ pressed }) => [{ marginTop: 18, borderRadius: 18, overflow: 'hidden' }, !dirty && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
              <LinearGradient colors={['#38bdf8', '#2563eb']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Send size={18} color="#fff" /><Text style={{ color: '#fff', fontSize: 16.5, fontWeight: '800' }}>{dirty ? 'Send update' : 'Up to date'}</Text>
              </LinearGradient>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <Radio size={13} color={c.dim} />
              <Text style={{ color: c.dim, fontSize: 11.5, fontFamily: mono, flex: 1 }} numberOfLines={1}>{wire}</Text>
              <Text style={{ color: c.dim, fontSize: 11.5 }}>{new TextEncoder().encode(wire).length}/200 B</Text>
            </View>
            <Text style={{ color: c.dim, fontSize: 12, lineHeight: 17, marginTop: 8 }}>
              One small radio message. Send one whenever beds change, or at least every 30 minutes: the command centre trusts fresh numbers more and sends patients where there is room.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
