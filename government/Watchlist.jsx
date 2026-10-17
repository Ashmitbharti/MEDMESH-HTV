import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import WeatherBackdrop from '../dashboard/WeatherBackdrop';
import { useHazard } from '../dashboard/hazardService';
import { CircleCheck, EyeOff, Footprints, Sparkles, UserRoundSearch } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useAuth } from '../auth/AuthContext';
import { useClock } from '../ui3d/project';
import { Card, Label } from '../hospital/controls';
import RiskTerrain from './RiskTerrain';
import MitigationDeck from './MitigationDeck';
import { DataStatus, GovHeader } from './Overview';
import { NEED_TINT, post, useGov } from './govService';

export default function Watchlist() {
  const hz = useHazard();
  const { width } = useWindowDimensions();
  const { account } = useAuth();
  const { now } = useClock(true, 1);
  const st = useGov('watchlist', account?.email, 6000);
  const [sel, setSel] = useState(null);
  const [sent, setSent] = useState({});
  const [deck, setDeck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const d = st.data;
  const area = d?.areas.find((a) => a.id === sel);
  const maxRisk = Math.max(1, ...(d?.areas || []).map((a) => a.risk));

  async function wellness(token) {
    setSent((s) => ({ ...s, [token]: { busy: true } }));
    try { const r = await post('/api/gov/wellness', { token, who: account?.email }); setSent((s) => ({ ...s, [token]: r })); }
    catch (e) { setSent((s) => ({ ...s, [token]: { error: e.message } })); }
  }
  async function makeDeck() {
    setBusy(true); setErr('');
    try { setDeck(await post('/api/gov/mitigation', { who: account?.email })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <WeatherBackdrop kind={hz.kind} />
      <LinearGradient colors={['rgba(244,114,182,0.18)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 340 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <GovHeader kicker="GOVERNMENT · WATCHLIST" title={'Who becomes an\nemergency when the\nnetwork goes down.'} tint="#f472b6" />
        <DataStatus state={st} now={now} />
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 10 }}>
          {d ? `${d.people} people opted in on their MedMesh ID because they depend on oxygen, powered devices, dialysis or insulin, or live alone with limited mobility.` : ''}
        </Text>

        <View style={{ marginHorizontal: -10, marginTop: 4 }}>
          <RiskTerrain width={width - 20} data={d} nodes={d?.nodes || []} selected={sel} onSelect={(id) => setSel(id === sel ? null : id)} />
        </View>
        <Text style={{ color: c.dim, fontSize: 11.5, textAlign: 'center', marginTop: -4 }}>Beam height = risk · rings = radio coverage · red sparks = people not heard from</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {Object.entries(d?.totals || {}).map(([k, n]) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: NEED_TINT[k] }} />
              <Text style={{ color: c.ink, fontSize: 12.5, fontWeight: '700' }}>{d.needs[k]}</Text>
              <Text style={{ color: c.ink, fontSize: 12.5, fontWeight: '900' }}>{n}</Text>
            </View>
          ))}
        </View>

        {area ? (
          <Card tint="#f472b6" active>
            <Label tint="#f472b6">{area.name.toUpperCase()} · RISK {Math.round(area.risk)}</Label>
            <Text style={{ color: c.ink, fontSize: 14, lineHeight: 20 }}>
              {area.people} people · {Object.entries(area.needs).filter(([, v]) => v).map(([k, v]) => `${v} ${d.needs[k].toLowerCase()}`).join(' · ') || 'no registered needs'}
            </Text>
            {area.factors.map((f) => <Text key={f} style={{ color: '#fecdd3', fontSize: 12.5, marginTop: 5 }}>• {f}</Text>)}
            <Text style={{ color: c.dim, fontSize: 12, marginTop: 8 }}>Nearest working radio node {area.node_km} km</Text>
          </Card>
        ) : null}

        <Card>
          <Label tint="#f472b6">AREAS BY RISK</Label>
          {(d?.areas || []).filter((a) => a.people).map((a) => (
            <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`${a.name} risk ${Math.round(a.risk)}`} onPress={() => setSel(a.id)} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700', flex: 1 }}>{a.name}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>{a.people} people{a.silent ? ` · ${a.silent} silent` : ''}  </Text>
                <Text style={{ color: c.ink, fontSize: 14, fontWeight: '900' }}>{Math.round(a.risk)}</Text>
              </View>
              <View style={{ height: 7, borderRadius: 4, backgroundColor: c.line, marginTop: 5, overflow: 'hidden' }}>
                <View style={{ width: `${(100 * a.risk) / maxRisk}%`, height: 7, backgroundColor: '#f472b6' }} />
              </View>
              {a.factors[0] ? <Text style={{ color: c.dim, fontSize: 11.5, marginTop: 3 }} numberOfLines={1}>{a.factors.join(' · ')}</Text> : null}
            </Pressable>
          ))}
        </Card>

        <Card tint="#f43f5e" active={!!d?.silent?.length}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <UserRoundSearch size={16} color="#fb7185" />
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '800', flex: 1 }}>Not heard from in {Math.round((d?.silent_after_min || 180) / 60)}+ hours</Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18, marginTop: 6 }}>
            No check-in, SOS or medicine request from these people since the event started. You see a code, not a name. “Send a check” gives responders the place.
          </Text>
          {(d?.silent || []).slice(0, 12).map((p) => {
            const r = sent[p.token];
            return (
              <View key={p.token} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: c.line }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.ink, fontSize: 14, fontWeight: '800' }}><Text style={{ fontFamily: mono }}>{p.token}</Text> · {p.area_name}</Text>
                  <Text style={{ color: c.muted, fontSize: 12 }}>{p.needs.map((n) => d.needs[n]).join(', ')} · silent {p.silent_h} h{p.synthetic ? ' · demo' : ''}</Text>
                </View>
                {r?.ok ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><CircleCheck size={15} color={c.green} /><Text style={{ color: '#bbf7d0', fontSize: 12, fontWeight: '800' }}>{r.responders ? `${r.responders} responder(s)` : 'Logged'}</Text></View>
                ) : (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Send a check for ${p.token}`} onPress={() => wellness(p.token)} disabled={r?.busy}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, minHeight: 38, borderRadius: 12, backgroundColor: 'rgba(244,63,94,0.16)', borderWidth: 1, borderColor: 'rgba(244,63,94,0.5)' }}>
                    <Footprints size={14} color="#fda4af" /><Text style={{ color: '#fecdd3', fontSize: 12.5, fontWeight: '800' }}>{r?.busy ? 'Sending…' : 'Send a check'}</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
          {d && !d.silent.length ? <Text style={{ color: c.dim, fontSize: 13, marginTop: 10 }}>Everyone on the list has been heard from recently.</Text> : null}
        </Card>

        <Card tint={c.violet} active>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color={c.violet} />
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '800', flex: 1 }}>Mitigation deck</Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18, marginTop: 6 }}>
            Gemini turns the risk by area into a plan for the next outage: where to add radio nodes, pre-stage oxygen and generators, hold insulin, and run check-in rounds. Each action must cite the facts it is based on.
          </Text>
          {err ? <Text style={{ color: '#fda4af', fontSize: 12.5, marginTop: 8 }}>{err}</Text> : null}
          <Pressable accessibilityRole="button" onPress={makeDeck} disabled={busy}
            style={({ pressed }) => [{ marginTop: 12, minHeight: 50, borderRadius: 16, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.violet }, pressed && { opacity: 0.85 }]}>
            {busy ? <ActivityIndicator color="#1e1b4b" /> : <Sparkles size={16} color="#1e1b4b" />}
            <Text style={{ color: '#1e1b4b', fontSize: 15, fontWeight: '900' }}>{busy ? 'Building the deck…' : deck ? 'Build it again' : 'Build the mitigation deck'}</Text>
          </Pressable>
        </Card>
        {deck ? <MitigationDeck deck={deck} width={width} /> : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, padding: 13, borderRadius: 18, borderWidth: 1, borderColor: c.line }}>
          <EyeOff size={16} color={c.dim} />
          <Text style={{ color: c.dim, fontSize: 12.5, lineHeight: 18, flex: 1 }}>
            Opt-in only, from the MedMesh ID setup. Government sees counts by approximate area and anonymous codes. Only responders get a home location, for a wellness check, and every check is logged.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
