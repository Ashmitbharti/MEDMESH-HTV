import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Check, ChevronLeft, Clock, MapPin, Pill, Send, Store, Truck } from 'lucide-react-native';
import s from './Actions.styles';
import { c } from '../medmesh-id/theme';
import { loadProfile } from '../medmesh-id/profileService';
import { ago, getPosition } from '../dashboard/hazardService';
import { DEFAULT_POS, distanceKm, SITES } from '../dashboard/sites';
import { latest, newId, queue } from '../dashboard/outbox';

// Medication request: M|id|ITEM|urgency|travel|lat,lon|medmeshID  (urgency N out now · D within 24 h · 3 within 3 days)
// The command centre asks the pharmacies (MR) and answers with the best one (MA). Same codes as the command centre.
const MEDS = {
  INSULIN: 'Insulin', INHALER: 'Inhaler', EPIPEN: 'EpiPen', HEART: 'Heart medication', SEIZURE: 'Seizure medication', BP: 'Blood-pressure pills', OTHER: 'Something else',
};
const MATCH = { INSULIN: /insulin/i, INHALER: /inhaler|salbutamol|ventolin/i, EPIPEN: /epipen|epinephrine/i, HEART: /apixaban|warfarin|blood thinner|bisoprolol|heart/i, SEIZURE: /epilep|seizure|levetiracetam/i, BP: /pressure|amlodipine|lisinopril/i };
const URG = [['N', "I've run out now"], ['D', 'Within 24 hours'], ['3', 'Within 3 days']];

function Chip({ on, onPress, children, icon: I }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress} style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed]}>
      {on ? <Check size={14} color={c.sky} strokeWidth={3} /> : I ? <I size={14} color={c.muted} /> : null}
      <Text style={[s.chipText, on && s.chipTextOn]}>{children}</Text>
    </Pressable>
  );
}

export default function FindMedicine() {
  const [profile, setProfile] = useState(null);
  const [item, setItem] = useState(null);
  const [urg, setUrg] = useState(null);
  const [travel, setTravel] = useState(null);
  const [pos, setPos] = useState(DEFAULT_POS);
  const [sent, setSent] = useState(null);

  useFocusEffect(useCallback(() => {
    loadProfile().then(setProfile).catch(() => {});
    latest('medication').then((m) => setSent(m && Date.now() - m.at < 24 * 3600 * 1000 ? m : null));
    getPosition().then((p) => p && setPos(p));
  }, []));

  const meds = profile?.details?.medications || '';
  const mine = Object.keys(MATCH).filter((k) => MATCH[k].test(meds));
  const pharmacies = SITES.filter((x) => x.kind === 'pharmacy').map((x) => ({ ...x, km: distanceKm(pos, x) })).sort((a, b) => a.km - b.km);

  async function ask() {
    const id = newId();
    const where = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
    const m = await queue('medication', `M|${id}|${item}|${urg}|${travel}|${where}|${profile?.medmeshId || ''}`, { item, urg });
    setSent(m);
  }


  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <LinearGradient colors={['rgba(251,191,36,0.18)', 'rgba(5,7,15,0)']} style={s.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={s.back}>
          <ChevronLeft size={18} color={c.muted} /><Text style={s.backText}>Home</Text>
        </Pressable>
        <Text style={s.eyebrow}>FIND MEDICINE</Text>
        <Text style={s.title}>Which pharmacy{'\n'}has it in stock?</Text>
        <Text style={s.sub}>We ask the open pharmacies near you over the mesh. The command centre answers with the best one, or arranges a delivery.</Text>

        {sent ? (
          <View style={[s.done, { borderColor: 'rgba(251,191,36,0.45)', backgroundColor: 'rgba(251,191,36,0.07)' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Clock size={20} color={c.amber} />
              <Text style={[s.doneTitle, { color: '#fde68a' }]}>Request saved · waiting for a node</Text>
            </View>
            <Text style={s.rowSub}>{MEDS[sent.item]} · {URG.find((u) => u[0] === sent.urg)?.[1]} · {ago(sent.at)}</Text>
            <Text style={s.wire}>{sent.wire}</Text>
            <Pressable accessibilityRole="button" onPress={() => { setSent(null); setItem(null); setUrg(null); setTravel(null); }} style={[s.ghost, { marginTop: 12 }]}>
              <Text style={s.ghostText}>Ask for something else</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={s.label}>WHAT DO YOU NEED?</Text>
            <View style={s.chips}>
              {Object.entries(MEDS).map(([k, v]) => (
                <Chip key={k} on={item === k} icon={Pill} onPress={() => setItem(k)}>{v}{mine.includes(k) ? '  ·  yours' : ''}</Chip>
              ))}
            </View>
            {mine.length ? <Text style={s.hint}>{'"yours" = on your MedMesh ID medication list.'}</Text> : null}

            <Text style={s.label}>HOW URGENT?</Text>
            <View style={s.chips}>
              {URG.map(([k, v]) => <Chip key={k} on={urg === k} icon={Clock} onPress={() => setUrg(k)}>{v}</Chip>)}
            </View>

            <Text style={s.label}>CAN YOU GET THERE?</Text>
            <View style={s.chips}>
              <Chip on={travel === 1} icon={MapPin} onPress={() => setTravel(1)}>Yes, I can go</Chip>
              <Chip on={travel === 0} icon={Truck} onPress={() => setTravel(0)}>No, I need it brought</Chip>
            </View>

            <Pressable accessibilityRole="button" disabled={!item || !urg || travel === null} onPress={ask}
              style={({ pressed }) => [s.btn, (!item || !urg || travel === null) && { opacity: 0.45 }, pressed && s.pressed]}>
              <LinearGradient colors={['#f59e0b', '#b45309']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.btnFill}>
                <Send size={18} color="#fff" />
                <Text style={s.btnText}>Ask nearby pharmacies</Text>
              </LinearGradient>
            </Pressable>
          </>
        )}

        <Text style={s.label}>PHARMACIES NEAR YOU{pos.approx ? ' · APPROXIMATE' : ''}</Text>
        <View style={s.card}>
          {pharmacies.map((p, i) => (
            <View key={p.id}>
              {i ? <View style={s.sep} /> : null}
              <View style={s.row}>
                <Store size={18} color={p.open ? c.amber : c.dim} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, !p.open && { color: c.dim }]}>{p.name}</Text>
                  <Text style={s.rowSub}>{p.km.toFixed(1)} km · {p.open ? 'Open' : 'Closed'} · stock confirmed when they reply</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
