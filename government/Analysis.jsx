import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import WeatherBackdrop from '../dashboard/WeatherBackdrop';
import { useHazard } from '../dashboard/hazardService';
import { FileDown, Presentation, Sparkles } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useAuth } from '../auth/AuthContext';
import { useClock } from '../ui3d/project';
import { Card, Label } from '../hospital/controls';
import TimeRibbon from './TimeRibbon';
import { DataStatus, GovHeader } from './Overview';
import { BASE, getJSON, TRIAGE, useGov } from './govService';

function Stat({ label, value, sub, w }) {
  return (
    <View style={{ width: w, padding: 12, borderRadius: 18, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line }}>
      <Text style={{ color: c.muted, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6 }}>{label.toUpperCase()}</Text>
      <Text style={{ color: c.ink, fontSize: 22, fontWeight: '900', marginTop: 2 }}>{value ?? '—'}</Text>
      {sub ? <Text style={{ color: c.dim, fontSize: 11 }}>{sub}</Text> : null}
    </View>
  );
}

export default function Analysis() {
  const hz = useHazard();
  const { width } = useWindowDimensions();
  const { account } = useAuth();
  const { now } = useClock(true, 1);
  const st = useGov('analysis', account?.email, 15000);
  const [rev, setRev] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const d = st.data;
  const m = d?.metrics;
  const tw = (width - 50) / 2;
  const who = encodeURIComponent(account?.email || 'government');

  async function findings() {
    setBusy(true); setErr('');
    try { setRev((await getJSON('/api/review')).review); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <WeatherBackdrop kind={hz.kind} />
      <LinearGradient colors={['rgba(125,211,252,0.18)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 340 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <GovHeader kicker="GOVERNMENT · ANALYSIS" title={'What happened,\nand what to fix.'} tint={c.sky} />
        <DataStatus state={st} now={now} />

        <Text style={{ color: c.sky, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700', marginTop: 18 }}>NEW CASES OVER TIME · {d?.bin_min ?? 10}-MIN SLICES</Text>
        <View style={{ marginHorizontal: -10 }}>
          <TimeRibbon width={width - 20} timeline={d?.timeline || []} binMin={d?.bin_min || 10} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'center' }}>
          {[1, 2, 3].map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: TRIAGE[k].color }} /><Text style={{ color: c.muted, fontSize: 11.5 }}>{TRIAGE[k].label}</Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          <Stat w={tw} label="People helped" value={m?.cases.total} sub={`${m?.cases.duplicates_merged ?? 0} duplicate reports merged`} />
          <Stat w={tw} label="Decision time" value={m?.cases.decision_seconds_median != null ? (m.cases.decision_seconds_median < 1 ? '<1s' : `${m.cases.decision_seconds_median}s`) : null} sub="median, report → ambulance" />
          <Stat w={tw} label="Time to treatment" value={m?.cases.time_to_treatment_min_median != null ? `${m.cases.time_to_treatment_min_median} min` : null} sub="median, estimated" />
          <Stat w={tw} label="Reroutes" value={m?.cases.reroutes} sub={`${m?.diversions?.length ?? 0} passed the nearest hospital`} />
          <Stat w={tw} label="Medicine requests" value={m?.supplies.requests} sub={`${m?.supplies.fulfilled ?? 0} filled · ${Object.values(m?.supplies.unavailable || {}).reduce((a, b) => a + b, 0)} not found`} />
          <Stat w={tw} label="Mesh relays" value={m ? `${Math.round((m.mesh.multi_hop_share || 0) * 100)}%` : null} sub={`needed 2+ hops · ${m?.mesh.undelivered ?? 0} undelivered`} />
        </View>

        {d?.areas?.length ? (
          <Card>
            <Label>RESPONSE BY AREA</Label>
            <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderColor: c.line }}>
              {['Area', 'Cases', 'Decide', 'Arrive'].map((h, i) => <Text key={h} style={{ color: c.dim, fontSize: 11, fontWeight: '800', flex: i ? 1 : 2, textAlign: i ? 'right' : 'left' }}>{h}</Text>)}
            </View>
            {d.areas.map((a) => (
              <View key={a.id} style={{ flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderColor: c.line }}>
                <Text style={{ color: c.ink, fontSize: 13, flex: 2 }}>{a.name}</Text>
                <Text style={{ color: c.ink, fontSize: 13, flex: 1, textAlign: 'right' }}>{a.cases}</Text>
                <Text style={{ color: c.muted, fontSize: 13, flex: 1, textAlign: 'right' }}>{a.dispatch_sec != null ? `${a.dispatch_sec}s` : '—'}</Text>
                <Text style={{ color: c.muted, fontSize: 13, flex: 1, textAlign: 'right' }}>{a.arrive_min != null ? `${a.arrive_min}m` : '—'}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Card tint={c.violet} active>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color={c.violet} />
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '800', flex: 1 }}>After-action findings</Text>
            {rev ? <Text style={{ color: c.dim, fontSize: 11 }}>{rev.source === 'gemini' ? 'Gemini · checked' : 'rules (no Gemini)'}</Text> : null}
          </View>
          <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18, marginTop: 6 }}>
            Gemini reads the command centre’s numbers and writes findings. Each one must point to real records; anything that doesn’t is thrown out.
          </Text>
          {rev ? (
            <View style={{ marginTop: 10 }}>
              <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: '800' }}>{rev.headline}</Text>
              {rev.findings.map((f, i) => (
                <View key={i} style={{ marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: c.panel2 }}>
                  <Text style={{ color: c.ink, fontSize: 14, fontWeight: '800' }}>{f.title}</Text>
                  <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>{f.detail}</Text>
                  <Text style={{ color: '#bbf7d0', fontSize: 12.5, marginTop: 5, lineHeight: 18 }}>→ {f.recommendation}{f.owner ? ` (${f.owner})` : ''}</Text>
                  <Text style={{ color: c.dim, fontSize: 10.5, marginTop: 4, fontFamily: mono }}>evidence: {(f.evidence || []).join(', ')}</Text>
                </View>
              ))}
              {rev.next_drill ? <Text style={{ color: '#fde68a', fontSize: 13, marginTop: 10 }}>Next drill: {rev.next_drill}</Text> : null}
            </View>
          ) : null}
          {err ? <Text style={{ color: '#fda4af', fontSize: 12.5, marginTop: 8 }}>{err}</Text> : null}
          <Pressable accessibilityRole="button" onPress={findings} disabled={busy}
            style={({ pressed }) => [{ marginTop: 12, minHeight: 50, borderRadius: 16, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.violet }, pressed && { opacity: 0.85 }]}>
            {busy ? <ActivityIndicator color="#1e1b4b" /> : <Sparkles size={16} color="#1e1b4b" />}
            <Text style={{ color: '#1e1b4b', fontSize: 15, fontWeight: '900' }}>{busy ? 'Writing findings…' : rev ? 'Write them again' : 'Write findings with Gemini'}</Text>
          </Pressable>
        </Card>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Pressable accessibilityRole="button" disabled={!BASE} onPress={() => Linking.openURL(`${BASE}/review`)}
            style={({ pressed }) => [{ flex: 1, minHeight: 52, borderRadius: 16, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }, pressed && { opacity: 0.8 }]}>
            <Presentation size={16} color={c.sky} /><Text style={{ color: c.ink, fontSize: 14, fontWeight: '800' }}>Full review deck</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={!BASE} onPress={() => Linking.openURL(`${BASE}/api/gov/export.csv?who=${who}`)}
            style={({ pressed }) => [{ flex: 1, minHeight: 52, borderRadius: 16, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }, pressed && { opacity: 0.8 }]}>
            <FileDown size={16} color={c.sky} /><Text style={{ color: c.ink, fontSize: 14, fontWeight: '800' }}>Cases (CSV)</Text>
          </Pressable>
        </View>
        <Text style={{ color: c.dim, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
          The deck opens in the browser and saves as PDF. The CSV has no names or IDs: area, triage, times and hospital only.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
