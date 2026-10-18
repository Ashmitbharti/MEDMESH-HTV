import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import WeatherBackdrop from '../dashboard/WeatherBackdrop';
import { useHazard } from '../dashboard/hazardService';
import { router } from 'expo-router';
import { Eye, FlaskConical, Landmark, LogOut, ShieldCheck, WifiOff } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useAuth } from '../auth/AuthContext';
import { useClock } from '../ui3d/project';
import { ago, Card, Label } from '../hospital/controls';
import CityTable from './CityTable';
import { TRIAGE, useGov } from './govService';
import { SHN_NETWORK } from '../dashboard/sites';

export function GovHeader({ title, kicker, tint = c.violet }) {
  const { account, signOut } = useAuth();
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(167,139,250,0.16)' }}>
          <Landmark size={20} color={c.violet} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: tint, fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>{kicker}</Text>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: '800' }} numberOfLines={1}>{account?.name || 'Government'}</Text>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={async () => { await signOut(); router.replace('/welcome'); }}
          style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }}>
          <LogOut size={17} color={c.muted} />
        </Pressable>
      </View>
      <Text style={{ color: c.ink, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, marginTop: 16 }}>{title}</Text>
    </>
  );
}

export function DataStatus({ state, now }) {
  const live = state.live;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 10, borderRadius: 14, backgroundColor: live ? 'rgba(52,211,153,0.08)' : 'rgba(251,191,36,0.1)', borderWidth: 1, borderColor: live ? 'rgba(52,211,153,0.35)' : 'rgba(251,191,36,0.4)' }}>
      {live ? <Eye size={14} color={c.green} /> : <WifiOff size={14} color={c.amber} />}
      <Text style={{ color: c.muted, fontSize: 12, flex: 1, lineHeight: 16 }}>
        {live ? 'Live from the command centre · view only · this view is recorded in the audit log'
          : state.at ? `Command centre not reachable · showing the copy saved ${ago(state.at, now)}` : 'Command centre not reachable yet. Check that it is running and on the same network.'}
      </Text>
    </View>
  );
}

function Tile({ label, value, sub, tint = c.ink, w }) {
  return (
    <View style={{ width: w, padding: 12, borderRadius: 18, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line }}>
      <Text style={{ color: c.muted, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6 }}>{label.toUpperCase()}</Text>
      <Text style={{ color: tint, fontSize: 24, fontWeight: '900', marginTop: 2 }}>{value ?? '—'}</Text>
      {sub ? <Text style={{ color: c.dim, fontSize: 11 }}>{sub}</Text> : null}
    </View>
  );
}

export default function Overview() {
  const hz = useHazard();
  const { width } = useWindowDimensions();
  const { account } = useAuth();
  const { now } = useClock(true, 1);
  const st = useGov('overview', account?.email, 4000);
  const [sel, setSel] = useState(null);
  const d = st.data;
  const T = d?.totals || {};
  const area = d?.areas.find((a) => a.id === sel);
  const tw = (width - 50) / 2;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <WeatherBackdrop kind={hz.kind} />
      <LinearGradient colors={['rgba(167,139,250,0.2)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 360 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <GovHeader kicker="GOVERNMENT · OVERVIEW" title={'The whole response,\nat a glance.'} />
        <DataStatus state={st} now={now} />

        <View style={{ marginHorizontal: -10, marginTop: 6 }}>
          <CityTable width={width - 20} data={d} selected={sel} onSelect={(id) => setSel(id === sel ? null : id)} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: -4 }}>
          {[1, 2, 3].map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: TRIAGE[k].color }} /><Text style={{ color: c.muted, fontSize: 11.5 }}>{TRIAGE[k].label}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: c.green }} /><Text style={{ color: c.muted, fontSize: 11.5 }}>Free beds</Text></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.sky }} /><Text style={{ color: c.muted, fontSize: 11.5 }}>Radio node</Text></View>
        </View>
        <Text style={{ color: c.dim, fontSize: 11.5, textAlign: 'center', marginTop: 6 }}>Drag to turn · tap an area · block height = cases there</Text>

        {area ? (
          <Card tint={c.violet} active>
            <Label tint={c.violet}>{area.name.toUpperCase()} · APPROX. AREA</Label>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[1, 2, 3].map((k) => (
                <View key={k} style={{ flex: 1, padding: 10, borderRadius: 14, backgroundColor: c.panel2 }}>
                  <Text style={{ color: TRIAGE[k].color, fontSize: 10.5, fontWeight: '800' }}>{TRIAGE[k].label.toUpperCase()}</Text>
                  <Text style={{ color: c.ink, fontSize: 20, fontWeight: '900' }}>{area.cases[k] || 0}</Text>
                </View>
              ))}
            </View>
            <Text style={{ color: c.muted, fontSize: 13, marginTop: 10, lineHeight: 19 }}>
              {area.active} still being helped · {area.requests} medicine requests ({area.unmet} not found) · {area.checkins} “I’m safe” check-ins
            </Text>
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
          <Tile w={tw} label="Active cases" value={T.active} sub={`${T.cases ?? 0} reported in total`} />
          <Tile w={tw} label="Immediate" value={T.by_triage?.['1']} tint={TRIAGE[1].color} sub="most serious" />
          <Tile w={tw} label="Beds free" value={T.beds_total ? `${T.beds_free}/${T.beds_total}` : null} sub={T.hospitals_closed ? `${T.hospitals_closed} hospital(s) diverting` : 'all hospitals accepting'} tint={T.hospitals_closed ? c.amber : c.green} />
          <Tile w={tw} label="Time to decide" value={T.dispatch_sec_median != null ? (T.dispatch_sec_median < 1 ? '<1s' : `${T.dispatch_sec_median}s`) : null} sub="median, report → ambulance chosen" />
          <Tile w={tw} label="Medicine not found" value={T.unmet} sub={`of ${T.requests ?? 0} requests`} tint={T.unmet ? '#fda4af' : c.ink} />
          <Tile w={tw} label="Price flags" value={T.price_flags} sub="sellers above the fair cap" tint={T.price_flags ? '#fda4af' : c.ink} />
          <Tile w={tw} label="Roads closed" value={T.roads_closed} sub={`${T.flood_zones ?? 0} flood zone(s)`} />
          <Tile w={tw} label="Radio nodes down" value={T.nodes_down} tint={T.nodes_down ? '#fda4af' : c.green} sub="mesh health" />
        </View>

        <Card>
          <Label>HOSPITALS</Label>
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(SHN_NETWORK.source.url)} style={{ marginBottom: 4 }}>
            <Text style={{ color: c.dim, fontSize: 12, lineHeight: 17 }}>
              {SHN_NETWORK.name}: {SHN_NETWORK.beds} beds network-wide ({SHN_NETWORK.period}, public) · <Text style={{ color: c.violet }}>{SHN_NETWORK.source.title} ↗</Text>
            </Text>
          </Pressable>
          {(d?.hospitals || []).map((h) => (
            <View key={h.id} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700', flex: 1 }}>{h.name}</Text>
                <Text style={{ color: h.open ? c.ink : c.amber, fontSize: 13, fontWeight: '800' }}>{h.open ? `${h.free}/${h.total} beds` : 'Diverting'}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: c.line, marginTop: 5, overflow: 'hidden' }}>
                <View style={{ width: `${h.total ? (100 * h.free) / h.total : 0}%`, height: 6, backgroundColor: h.open ? c.green : '#64748b' }} />
              </View>
              <Text style={{ color: c.dim, fontSize: 11.5, marginTop: 3 }}>ER wait {h.er_wait ?? '?'} min · updated {h.updated || 'from planning data'}</Text>
            </View>
          ))}
        </Card>

        {d?.alerts?.length ? (
          <Card>
            <Label tint={c.amber}>PUBLIC ALERTS SENT</Label>
            {d.alerts.map((a) => <Text key={a} style={{ color: c.muted, fontSize: 13, marginTop: 6 }}>• {a}</Text>)}
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, padding: 13, borderRadius: 18, borderWidth: 1, borderColor: c.line }}>
          <ShieldCheck size={16} color={c.dim} />
          <Text style={{ color: c.dim, fontSize: 12.5, lineHeight: 18, flex: 1 }}>
            View only: dispatch and routing stay with the command centre. No names or MedMesh IDs are shown; people are counted by approximate area.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
