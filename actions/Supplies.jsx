import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import {
  BatteryCharging, Bike, Check, ChevronLeft, CircleCheck, CircleX, Clock, MapPin, Package, Pill, Plus, Send, Siren, Sparkles, Store, Wind,
} from 'lucide-react-native';
import s from './Actions.styles';
import { c, mono } from '../medmesh-id/theme';
import { loadProfile } from '../medmesh-id/profileService';
import { getPosition } from '../dashboard/hazardService';
import { bearing, compass, DEFAULT_POS, distanceKm, SITES } from '../dashboard/sites';
import { markOutbox, newId, queue } from '../dashboard/outbox';
import { forId, useMesh } from '../link/meshLink';
import LinkBanner from '../components/LinkBanner';
import { createScene, saveScene } from '../emergency/sceneService';

// M|id|ITEM|urgency|travel|lat,lon|medmeshID      urgency N out now · D within 24 h · 3 within 3 days
// The command centre asks up to 3 nearby places at once, picks the best "yes", holds it and replies with a pickup code.
const MEDS = { INSULIN: 'Insulin', INHALER: 'Inhaler', EPIPEN: 'EpiPen', HEART: 'Heart medicine', SEIZURE: 'Seizure medicine', BP: 'Blood-pressure pills' };
const KIT = { O2: 'Oxygen cylinder / refill', CPAPPWR: 'Power for CPAP / oxygen machine', STRIPS: 'Diabetic strips & needles', DRESS: 'Wound dressings', NEB: 'Nebuliser', OTHER: 'Something else' };
const NAMES = { ...MEDS, ...KIT };
const FROM_ID = [
  ['INSULIN', /insulin/i], ['INHALER', /inhaler|salbutamol|asthma|copd/i], ['EPIPEN', /epipen|epinephrine|anaphyla/i],
  ['HEART', /apixaban|warfarin|blood thinner|bisoprolol|heart/i], ['SEIZURE', /epilep|seizure|levetiracetam/i],
  ['BP', /pressure|amlodipine|lisinopril|hypertension/i], ['O2', /oxygen/i], ['CPAPPWR', /cpap|bipap|oxygen/i], ['STRIPS', /diabet|insulin/i],
];
const BREATHING_KIT = ['O2', 'CPAPPWR'];
const STEPS = ['Saved', 'Sent', 'Received', 'Asking places', 'Answer'];

function Chip({ on, onPress, children, icon: I, tone }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress}
      style={({ pressed }) => [s.chip, on && s.chipOn, tone && !on && { borderColor: tone + '66' }, pressed && s.pressed]}>
      {on ? <Check size={14} color={c.sky} strokeWidth={3} /> : I ? <I size={14} color={tone || c.muted} /> : null}
      <Text style={[s.chipText, on && s.chipTextOn]}>{children}</Text>
    </Pressable>
  );
}

function Tracker({ req, inbox, onNew }) {
  const msgs = forId(inbox, req.id);
  const acked = req.status === 'acked' || msgs.some((m) => m.code === 'A');
  const asking = msgs.filter((m) => m.code === 'H').pop();
  const answer = msgs.filter((m) => m.code === 'MA').pop();
  const step = answer ? 4 : asking ? 3 : acked ? 2 : req.status === 'sent' ? 1 : 0;
  const pid = answer?.f[1];
  const text = answer ? answer.f.slice(4).join('|') : '';
  const code = (text.match(/code ([A-Z0-9]{4})/i) || [])[1];
  const place = SITES.find((x) => x.id === pid);
  const none = pid === 'NONE' || pid === 'DUP';
  return (
    <View style={[s.card, { borderColor: none ? 'rgba(251,191,36,0.4)' : answer ? 'rgba(52,211,153,0.45)' : c.line }]}>
      <Text style={[s.rowTitle, { fontSize: 17 }]}>{NAMES[req.item] || req.item}</Text>
      <Text style={s.rowSub}>{req.travel ? 'Pickup' : 'Delivery'} · {{ N: 'out now', D: 'within 24 h', 3: 'within 3 days' }[req.urg]}</Text>
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 14 }}>
        {STEPS.map((t, i) => (
          <View key={t} style={{ flex: 1 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= step ? (none && i === 4 ? c.amber : c.green) : c.line2 }} />
            <Text style={{ color: i <= step ? c.ink : c.dim, fontSize: 10, fontWeight: '700', marginTop: 5 }}>{t}</Text>
          </View>
        ))}
      </View>
      {!answer && asking ? <Text style={[s.rowSub, { marginTop: 10 }]}>{asking.f.slice(3).join('|')}</Text> : null}
      {!answer && !asking ? <Text style={[s.rowSub, { marginTop: 10 }]}>{acked ? 'The command centre is asking nearby places.' : 'Waiting for a MedMesh node to send it.'}</Text> : null}
      {answer && !none ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <CircleCheck size={22} color={c.green} />
            <Text style={[s.rowTitle, { flex: 1 }]}>{place ? place.name : 'A nearby place'} has it</Text>
          </View>
          <Text style={s.rowSub}>{text}</Text>
          {code ? (
            <View style={{ alignItems: 'center', padding: 14, borderRadius: 16, backgroundColor: 'rgba(52,211,153,0.08)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.35)' }}>
              <Text style={{ color: c.muted, fontSize: 11, fontFamily: mono, letterSpacing: 1.6 }}>{req.travel ? 'SHOW THIS AT THE COUNTER' : 'GIVE THIS TO THE RESPONDER'}</Text>
              <Text style={{ color: '#bbf7d0', fontSize: 38, fontWeight: '900', letterSpacing: 10, fontFamily: mono, marginTop: 4 }}>{code}</Text>
            </View>
          ) : null}
          {place && req.travel ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <MapPin size={16} color={c.sky} />
              <Text style={s.rowSub}>{distanceKm(req.pos || DEFAULT_POS, place).toFixed(1)} km {compass(bearing(req.pos || DEFAULT_POS, place))} of you</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {answer && none ? (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 14 }}>
          <CircleX size={20} color={c.amber} />
          <Text style={[s.rowSub, { flex: 1, color: '#fde68a' }]}>{text}</Text>
        </View>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onNew} style={[s.ghost, { marginTop: 14 }]}><Plus size={16} color={c.ink} /><Text style={s.ghostText}>Ask for something else</Text></Pressable>
    </View>
  );
}

export default function Supplies() {
  const [profile, setProfile] = useState(null);
  const [item, setItem] = useState(null);
  const [left, setLeft] = useState(null);      // oxygen / power: how much is left
  const [urg, setUrg] = useState(null);
  const [travel, setTravel] = useState(null);
  const [pos, setPos] = useState(DEFAULT_POS);
  const [current, setCurrent] = useState(null);
  const [hidden, setHidden] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const { link, inbox, outbox } = useMesh();

  useFocusEffect(useCallback(() => {
    loadProfile().then((p) => {
      setProfile(p);
      const d = p?.details || {};
      const needsDelivery = /wheelchair|bed-bound|some help/i.test(d.mobility || '') || (d.lives_alone === 'Yes' && Number(d.age) >= 75);
      setTravel((t) => (t === null ? (needsDelivery ? 0 : null) : t));
    }).catch(() => {});
    getPosition().then((p) => p && setPos(p));
    setNow(Date.now());
  }, []));

  const req = current || [...outbox].reverse().find((o) => o.kind === 'medication' && now - o.at < 24 * 3600 * 1000 && !o.dismissed && !hidden.includes(o.id));
  const d = profile?.details || {};
  const idText = [d.medications, d.conditions, d.devices].join(' ');
  const mine = FROM_ID.filter(([, re]) => re.test(idText)).map(([k]) => k);
  const breathing = BREATHING_KIT.includes(item);
  const urgency = breathing ? (left === 'lt2' || left === '2to12' ? 'N' : left ? 'D' : null) : urg;
  const ready = item && urgency && travel !== null && left !== 'lt2';
  const places = SITES.filter((x) => x.kind !== 'hospital').map((x) => ({ ...x, km: distanceKm(pos, x) })).sort((a, b) => a.km - b.km);

  async function send() {
    const id = newId();
    const where = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
    const m = await queue('medication', `M|${id}|${item}|${urgency}|${travel}|${where}|${profile?.medmeshId || ''}`, { item, urg: urgency, travel, pos });
    setCurrent(m);
  }

  async function oxygenSos() {
    const sc = await createScene('self');
    sc.people[0] = { ...sc.people[0], breathing: 'fast', complaint: 'BR', note: item === 'O2' ? 'home oxygen running out (<2 h)' : 'oxygen/CPAP machine has no power' };
    sc.phase = 'where';
    await saveScene(sc);
    router.push('/sos');
  }

  function reset() {
    setCurrent(null); setItem(null); setLeft(null); setUrg(null);
    if (req) { setHidden((h) => [...h, req.id]); markOutbox(req.id, { dismissed: true }).catch(() => {}); }
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <LinearGradient colors={['rgba(251,191,36,0.18)', 'rgba(5,7,15,0)']} style={s.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={s.back}>
          <ChevronLeft size={18} color={c.muted} /><Text style={s.backText}>Home</Text>
        </Pressable>
        <LinkBanner link={link} ids={req ? [req.id] : []} outbox={outbox} />
        <Text style={s.eyebrow}>MEDICINE & SUPPLIES</Text>
        <Text style={s.title}>{req ? 'Your request' : 'What do you need?'}</Text>
        {!req ? <Text style={s.sub}>We ask up to 3 nearby pharmacies and suppliers at once, pick the best answer and hold it for you.</Text> : null}

        {req ? <Tracker req={req} inbox={inbox} onNew={reset} /> : (
          <>
            {mine.length ? (
              <>
                <Text style={s.label}><Sparkles size={11} color={c.sky} />  FROM YOUR MEDMESH ID</Text>
                <View style={s.chips}>{mine.map((k) => <Chip key={k} on={item === k} icon={BREATHING_KIT.includes(k) ? Wind : Pill} onPress={() => setItem(k)}>{NAMES[k]}</Chip>)}</View>
              </>
            ) : null}
            <Text style={s.label}>MEDICINES</Text>
            <View style={s.chips}>{Object.entries(MEDS).filter(([k]) => !mine.includes(k)).map(([k, v]) => <Chip key={k} on={item === k} icon={Pill} onPress={() => setItem(k)}>{v}</Chip>)}</View>
            <Text style={s.label}>EQUIPMENT & SUPPLIES</Text>
            <View style={s.chips}>
              {Object.entries(KIT).filter(([k]) => !mine.includes(k)).map(([k, v]) => (
                <Chip key={k} on={item === k} icon={k === 'O2' ? Wind : k === 'CPAPPWR' ? BatteryCharging : Package} onPress={() => setItem(k)}>{v}</Chip>
              ))}
            </View>

            {item && breathing ? (
              <>
                <Text style={s.label}>{item === 'O2' ? 'HOW MUCH OXYGEN IS LEFT?' : 'HOW LONG CAN THE MACHINE RUN?'}</Text>
                <View style={s.chips}>
                  <Chip on={left === 'lt2'} icon={Siren} tone={c.red} onPress={() => setLeft('lt2')}>Less than 2 hours</Chip>
                  <Chip on={left === '2to12'} icon={Clock} onPress={() => setLeft('2to12')}>2 to 12 hours</Chip>
                  <Chip on={left === 'gt12'} icon={Clock} onPress={() => setLeft('gt12')}>More than 12 hours</Chip>
                </View>
                {left === 'lt2' ? (
                  <View style={[s.done, { borderColor: 'rgba(244,63,94,0.5)', backgroundColor: 'rgba(244,63,94,0.08)' }]}>
                    <Text style={[s.doneTitle, { color: '#fecdd3' }]}>This is a medical emergency</Text>
                    <Text style={s.rowSub}>
                      Running out of oxygen can get dangerous fast. Paramedics carry oxygen and can take you somewhere that has it.
                      Send an SOS now. You can still ask for a refill afterwards.
                    </Text>
                    <Pressable accessibilityRole="button" onPress={oxygenSos} style={({ pressed }) => [s.btn, pressed && s.pressed]}>
                      <LinearGradient colors={['#e11d48', '#9f1239']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.btnFill}>
                        <Siren size={18} color="#fff" /><Text style={s.btnText}>Send an SOS now</Text>
                      </LinearGradient>
                    </Pressable>
                    <Pressable onPress={() => setLeft('2to12')} style={{ alignItems: 'center', paddingTop: 12 }}>
                      <Text style={s.rowSub}>I have help already · just ask for a refill</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}

            {item && !breathing ? (
              <>
                <Text style={s.label}>HOW URGENT?</Text>
                <View style={s.chips}>
                  {[['N', "I've run out now"], ['D', 'Within 24 hours'], ['3', 'Within 3 days']].map(([k, v]) => <Chip key={k} on={urg === k} icon={Clock} onPress={() => setUrg(k)}>{v}</Chip>)}
                </View>
              </>
            ) : null}

            {item && urgency && left !== 'lt2' ? (
              <>
                <Text style={s.label}>PICKUP OR DELIVERY?</Text>
                <View style={s.chips}>
                  <Chip on={travel === 1} icon={MapPin} onPress={() => setTravel(1)}>I can go and get it</Chip>
                  <Chip on={travel === 0} icon={Bike} onPress={() => setTravel(0)}>Bring it to me</Chip>
                </View>
                {travel === 0 && /wheelchair|bed-bound|some help/i.test(d.mobility || '') ? <Text style={s.hint}>Suggested from your MedMesh ID.</Text> : null}
                <Text style={s.hint}>One request per item, for the next few days. A pharmacist checks it when you collect.</Text>
              </>
            ) : null}

            <Pressable accessibilityRole="button" disabled={!ready} onPress={send} style={({ pressed }) => [s.btn, !ready && { opacity: 0.45 }, pressed && s.pressed]}>
              <LinearGradient colors={['#f59e0b', '#b45309']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.btnFill}>
                <Send size={18} color="#fff" /><Text style={s.btnText}>Ask nearby places</Text>
              </LinearGradient>
            </Pressable>
          </>
        )}

        <Text style={s.label}>NEARBY{pos.approx ? ' · APPROXIMATE LOCATION' : ''}</Text>
        <View style={s.card}>
          {places.map((p, i) => (
            <View key={p.id}>
              {i ? <View style={s.sep} /> : null}
              <View style={s.row}>
                {p.kind === 'supplier' ? <Wind size={18} color={p.open ? c.sky : c.dim} /> : <Store size={18} color={p.open ? c.amber : c.dim} />}
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowTitle, !p.open && { color: c.dim }]}>{p.name}</Text>
                  <Text style={s.rowSub}>{p.km.toFixed(1)} km {compass(bearing(pos, p))} · {p.open ? 'Open' : 'Closed'} · {p.kind === 'supplier' ? 'oxygen & equipment' : 'pharmacy'}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
