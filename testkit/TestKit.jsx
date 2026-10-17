import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ambulance, Building2, ChevronLeft, CircleCheck, CircleX, Droplets, FlaskConical, HeartPulse, Pill, RadioTower, RotateCcw, Siren, Wind } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';

// Test kit: fires realistic radio messages into the command centre's simulated mesh, so one person with one phone can
// test every login. Each card says which screen reacts. Needs the command centre running in --sim mode.
const BASE = (process.env.EXPO_PUBLIC_COMMAND_CENTRE_URL || '').replace(/\/$/, '');
const rid = () => Math.random().toString(36).slice(2, 6);

const SCENARIOS = [
  {
    id: 'crash', icon: Siren, tint: '#f43f5e', title: 'Car crash: 3 people hurt near Centenary',
    watch: 'Hospital (Centenary) → Incoming · Government → Overview',
    msgs: () => {
      const z = rid();
      return [['FIELD', `Z|${z}|3|43.7790,-79.2100|CRASH|FUEL`],
        ['FIELD', `R|${rid()}|1|UN|A|3|0X00|43.7790,-79.2100||BG:O-;AL:Penicillin`],
        ['FIELD', `R|${rid()}|2|FX|S|3|0N10|43.7790,-79.2100||BG:A+`],
        ['FIELD', `R|${rid()}|1|CP|A|3|0F11|43.7790,-79.2100||`]];
    },
  },
  {
    id: 'cardiac', icon: HeartPulse, tint: '#fb7185', title: 'Chest pain at UTSC, person has a MedMesh ID',
    watch: 'Hospital → Incoming (blood group & allergy from the ID) · Government',
    msgs: () => [['FIELD', `R|${rid()}|1|CP|A|1|0F10|43.7840,-79.1870|MX4K9P|`]],
  },
  {
    id: 'meds', icon: Pill, tint: '#34d399', title: '5 people ask for medicine near Care IDA (Ellesmere Rd)',
    watch: 'Pharmacy (Care IDA) → Requests & Nearby · Government',
    msgs: () => [['FIELD', `M|${rid()}|INSULIN|N|1|43.7880,-79.1760|`], ['FIELD', `M|${rid()}|INHALER|D|0|43.7930,-79.1700|`],
      ['FIELD', `M|${rid()}|EPIPEN|3|1|43.7840,-79.1860|`], ['FIELD', `M|${rid()}|HEART|D|1|43.7800,-79.1650|`], ['FIELD', `M|${rid()}|INSULIN|D|1|43.7960,-79.1800|`]],
  },
  {
    id: 'oxygen', icon: Wind, tint: '#38bdf8', title: 'Someone runs out of home oxygen',
    watch: 'Home Oxygen supplier → Requests',
    msgs: () => [['FIELD', `M|${rid()}|O2|N|0|43.7700,-79.2250|ZP5W1K`]],
  },
  {
    id: 'order', icon: Building2, tint: '#fca5a5', title: 'Centenary orders 10 wound dressings',
    watch: 'Pharmacy (nearest with stock: Food Basics) → Requests → Hospital orders',
    msgs: () => [['RESP', 'J|H|CEN|Centenary (test kit)'], ['RESP', `S|${rid()}|CEN|DRESS|10`]],
  },
  {
    id: 'flood', icon: Droplets, tint: '#7dd3fc', title: 'Ellesmere Rd floods',
    watch: 'Ambulances reroute · Government → Overview (roads, flood zones)',
    msgs: () => [['RESP', 'B|Ellesmere Rd|flooded'], ['RESP', 'F|43.7765,-79.2300|500']],
  },
  {
    id: 'safe', icon: CircleCheck, tint: '#34d399', title: 'Margaret says “I’m safe”',
    watch: 'Government → Watchlist (she drops off the not-heard-from list)',
    msgs: () => [['FIELD', `O|${rid()}|SAFE|Margaret|43.7840,-79.1870|ZP5W1K`]],
  },
];

function Mark({ v }) {
  if (v === 'busy') return <ActivityIndicator size="small" color={c.sky} />;
  if (v === 'ok') return <CircleCheck size={18} color={c.green} />;
  return v === 'fail' ? <CircleX size={18} color="#fb7185" /> : null;
}

export default function TestKit() {
  const [st, setSt] = useState({});
  const [relayDown, setRelayDown] = useState(false);

  async function call(path, body) {
    const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return r.json();
  }
  async function run(s) {
    setSt((x) => ({ ...x, [s.id]: 'busy' }));
    try {
      for (const [node, text] of s.msgs()) {
        await call('/api/sim/send', { node, text });
        await new Promise((res) => setTimeout(res, 500));
      }
      setSt((x) => ({ ...x, [s.id]: 'ok' }));
    } catch {
      setSt((x) => ({ ...x, [s.id]: 'fail' }));
    }
  }
  async function relay() {
    try { await call('/api/sim/node/RELAY', { online: relayDown }); setRelayDown(!relayDown); setSt((x) => ({ ...x, relay: 'ok' })); }
    catch { setSt((x) => ({ ...x, relay: 'fail' })); }
  }
  async function reset() {
    setSt({ reset: 'busy' });
    try { await call('/api/reset'); await call('/api/sim/node/RELAY', { online: true }); setRelayDown(false); setSt({ reset: 'ok' }); } catch { setSt({ reset: 'fail' }); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 }}>
          <ChevronLeft size={18} color={c.muted} /><Text style={{ color: c.muted, fontWeight: '600' }}>Back</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <FlaskConical size={18} color={c.amber} />
          <Text style={{ color: c.amber, fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>TEST KIT</Text>
        </View>
        <Text style={{ color: c.ink, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 }}>Make something{'\n'}happen.</Text>
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
          Each button sends real radio-format messages into the command centre’s simulated mesh. Sign in with the account named on the card to watch it arrive.
        </Text>
        <Text style={{ color: BASE ? c.dim : '#fda4af', fontSize: 12, marginTop: 8, fontFamily: mono }}>{BASE || 'EXPO_PUBLIC_COMMAND_CENTRE_URL is not set'}</Text>

        {SCENARIOS.map((s) => {
          const I = s.icon;
          return (
            <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={s.title} onPress={() => run(s)} disabled={!BASE}
              style={({ pressed }) => [{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 12, padding: 14, borderRadius: 20, backgroundColor: c.panel, borderWidth: 1, borderColor: st[s.id] === 'ok' ? 'rgba(52,211,153,0.5)' : c.line }, pressed && { opacity: 0.8 }]}>
              <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: s.tint + '22' }}><I size={19} color={s.tint} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontSize: 14.5, fontWeight: '800' }}>{s.title}</Text>
                <Text style={{ color: c.dim, fontSize: 12, marginTop: 2, lineHeight: 16 }}>{s.watch}</Text>
              </View>
              <Mark v={st[s.id]} />
            </Pressable>
          );
        })}

        <View style={{ marginTop: 12, padding: 14, borderRadius: 20, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line }}>
          <Text style={{ color: c.ink, fontSize: 14.5, fontWeight: '800' }}>Weather alert from the command centre</Text>
          <Text style={{ color: c.dim, fontSize: 12, marginTop: 2 }}>Citizen home screen shows it as live weather around the Shield</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {[['STORM', 'Storm'], ['SNOW', 'Snow'], ['FLOOD', 'Flood'], ['RAIN', 'Rain'], ['FIRE', 'Wildfire'], ['NONE', 'All clear']].map(([k, label]) => (
              <Pressable key={k} accessibilityRole="button" accessibilityLabel={`Weather ${label}`} disabled={!BASE}
                onPress={async () => { try { await call('/api/hazard', { type: k, severity: 'WARN', area: 'Scarborough' }); setSt((x) => ({ ...x, hazard: k })); } catch { setSt((x) => ({ ...x, hazard: 'fail' })); } }}
                style={{ paddingHorizontal: 12, minHeight: 38, borderRadius: 12, justifyContent: 'center', borderWidth: 1, borderColor: st.hazard === k ? c.sky : c.line2, backgroundColor: st.hazard === k ? 'rgba(125,211,252,0.15)' : 'transparent' }}>
                <Text style={{ color: c.ink, fontSize: 13, fontWeight: '700' }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel={relayDown ? 'Bring the relay node back' : 'Take the relay node down'} onPress={relay} disabled={!BASE}
          style={({ pressed }) => [{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 12, padding: 14, borderRadius: 20, backgroundColor: c.panel, borderWidth: 1, borderColor: relayDown ? 'rgba(244,63,94,0.5)' : c.line }, pressed && { opacity: 0.8 }]}>
          <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(251,191,36,0.15)' }}><RadioTower size={19} color={c.amber} /></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontSize: 14.5, fontWeight: '800' }}>{relayDown ? 'Bring the relay node back' : 'Take the relay node down (power cut)'}</Text>
            <Text style={{ color: c.dim, fontSize: 12, marginTop: 2 }}>Mesh heals through the other path · Government → Watchlist risk goes up</Text>
          </View>
          <Mark v={st.relay} />
        </Pressable>

        <Pressable accessibilityRole="button" accessibilityLabel="Reset the command centre" onPress={reset} disabled={!BASE}
          style={({ pressed }) => [{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: c.line2, borderStyle: 'dashed' }, pressed && { opacity: 0.8 }]}>
          <RotateCcw size={18} color={c.muted} />
          <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700', flex: 1 }}>Reset the command centre (clear all cases)</Text>
          <Mark v={st.reset} />
        </Pressable>

        <View style={{ marginTop: 22, padding: 14, borderRadius: 20, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ambulance size={16} color={c.sky} />
            <Text style={{ color: c.ink, fontSize: 14.5, fontWeight: '800' }}>Test MedMesh IDs (synthetic people)</Text>
          </View>
          <Text style={{ color: c.dim, fontSize: 12, marginTop: 4 }}>Attach one to an SOS under “Someone else” to test hospital routing and the patient details.</Text>
          {[['ZP5W1K', 'Margaret, 79 · heart failure, home oxygen, lives alone'], ['MX4K9P', 'Arun, 61 · diabetes, atrial fibrillation, O-'],
            ['QL7T2D', 'Grace, 34 · pregnant 32 weeks'], ['HV3N8R', 'Liam, 8 · asthma, peanut allergy'], ['TB8C6M', 'Omar, 45 · epilepsy']].map(([id, who]) => (
            <View key={id} style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <Text style={{ color: c.sky, fontFamily: mono, fontSize: 13, fontWeight: '800', width: 70 }}>{id}</Text>
              <Text style={{ color: c.muted, fontSize: 12.5, flex: 1 }}>{who}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
