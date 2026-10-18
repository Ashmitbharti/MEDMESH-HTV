import { useEmergencyUpdates, cloudStatus } from '../workflow/useEmergencyUpdates';
import { cloudCaseId } from '../cloud/cloudSync';
import { hospitals } from '../command-center/facilities';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import {
  Ambulance, BellRing, Building2, CircleCheck, Clock, HeartHandshake, MessageSquareText, Phone, Pill, Radio, ShieldCheck,
} from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import s from './Status.styles';
import LinkBanner from '../components/LinkBanner';
import OfflineMap from '../map/OfflineMap';
import { loadMap, refreshMap } from '../map/mapData';
import { useMesh } from '../link/meshLink';
import { isOpen, loadScene } from '../emergency/sceneService';
import { loadProfile } from '../medmesh-id/profileService';
import { caseStatus, etaLeft } from './caseStatus';
import { distanceKm, SITES } from '../dashboard/sites';
import { TRIAGE, triageOf } from '../emergency/sosLogic';
import { useClock } from '../ui3d/project';

const HERO = {
  cancelled: { tint: ['#334155', '#0b1020'], title: 'Request cancelled', sub: 'Command Center has closed this request.' },
  saved: { tint: ['#78350f', '#1c1206'], title: 'Your report is safe on this phone', sub: 'It goes out by itself as soon as a MedMesh node is in range. Keep the app open.' },
  sent: { tint: ['#1e3a8a', '#0b1020'], title: 'Your report is on its way', sub: 'Travelling across the mesh to the command centre.' },
  received: { tint: ['#1e3a8a', '#0b1020'], title: "We've got your report", sub: 'The command centre is choosing the right hospital and the nearest ambulance.' },
  coming: { tint: ['#9f1239', '#1a0b14'], title: 'Help is on its way', sub: "Stay where you are. Paramedics are coming to you. You're not alone in this." },
  withyou: { tint: ['#065f46', '#06140f'], title: "You're in safe hands", sub: 'Paramedics are with you and heading to the hospital.' },
  arrived: { tint: ['#065f46', '#06140f'], title: "You've arrived", sub: 'The team at the hospital already has your details.' },
};

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export default function Status() {
  const { width } = useWindowDimensions();
  const { link, inbox, outbox } = useMesh();
  const { now } = useClock(true, 1);
  const [scene, setScene] = useState(null);
  const [profile, setProfile] = useState(null);
  const [geo, setGeo] = useState(null);
  const [sel, setSel] = useState(0);

  useFocusEffect(useCallback(() => {
    loadScene().then((x) => setScene(x));
    loadProfile().then(setProfile).catch(() => {});
  }, []));
  useEffect(() => {
    loadMap().then(setGeo);
    refreshMap().then((g) => g && setGeo(g));
  }, []);

  const people = scene ? scene.people.filter((p) => scene.sent[p.key]) : [];
  const person = people[Math.min(sel, Math.max(0, people.length - 1))];
  const caseId = person ? scene.sent[person.key] : '';
  const { records, error: cloudError } = useEmergencyUpdates(Object.values(scene?.sent || {}));
  const cloud = records.find((r) => r.id === cloudCaseId(caseId));
  const radio = caseId ? caseStatus(caseId, inbox, outbox) : null;
  const st = cloud && !['withyou', 'arrived'].includes(radio?.phase) ? cloudStatus(cloud) : radio;
  const hosp = st && SITES.find((x) => x.id === st.hospId || x.cloudId === st.hospId);
  const hospName = hosp?.name || hospitals.find((h) => h.hosid === st?.hospId)?.name || st?.hospName || '';
  const you = scene?.loc?.lat != null ? scene.loc : null;
  const eta = st && now ? etaLeft(st.etaAt, now) : null;
  const self = scene?.mode === 'self' && person === scene?.people[0];
  const contactName = st?.contact?.name || ((profile?.details?.contact || '').split(',')[0].trim());
  const hero = st ? HERO[st.phase] : null;

  const alerts = inbox.filter((m) => m.code === 'N' || m.code === 'X').slice(-5).reverse();
  const supply = [...outbox].reverse().find((o) => o.kind === 'medication' && !o.dismissed);
  const supplyAns = supply && inbox.filter((m) => m.code === 'MA' && m.f[0] === supply.id).pop();

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.eyebrow}>STATUS & MESSAGES</Text>
        {!cloud ? <LinkBanner link={link} ids={caseId ? [caseId] : []} outbox={outbox} /> : null}

        {cloudError ? <Text style={{ color: c.amber, marginTop: 10 }}>{cloudError}</Text> : null}
        {cloud ? <Text style={{ color: c.muted, marginTop: 10 }}>{cloud.demo ? 'Demo on this device' : 'Command Center updates via Supabase'}</Text> : null}
        {!st ? (
          <View style={s.empty}>
            <ShieldCheck size={36} color={c.green} />
            <Text style={s.emptyTitle}>No active emergency</Text>
            <Text style={s.emptySub}>{"When you send a report, this is where you'll see which hospital you're going to, when the ambulance arrives, and where it is on the map."}</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push('/')} style={s.emptyBtn}><Text style={s.emptyBtnText}>Go to Home</Text></Pressable>
          </View>
        ) : (
          <>
            {people.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }} contentContainerStyle={{ gap: 8 }}>
                {people.map((p, i) => {
                  const T = TRIAGE[triageOf(p)];
                  const on = i === sel;
                  return (
                    <Pressable key={p.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setSel(i)}
                      style={[s.tab, on && { borderColor: T.color, backgroundColor: T.color + '1f' }]}>
                      <View style={[s.dot, { backgroundColor: T.color }]} />
                      <Text style={[s.tabText, on && { color: c.ink }]}>{scene.mode === 'self' && i === 0 ? 'You' : p.label || `Person ${i + 1}`}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            <LinearGradient colors={hero.tint} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
              {hospName ? (
                <View style={s.goingRow}>
                  <Building2 size={15} color="#fecdd3" />
                  <Text style={s.going}>{st.phase === 'arrived' ? 'AT' : 'GOING TO'}</Text>
                </View>
              ) : null}
              {hospName ? <Text style={s.hospital}>{hospName}</Text> : null}
              {hospName && hosp && you ? <Text style={s.hospSub}>{distanceKm(you, hosp).toFixed(1)} km away · chosen by the command centre for this emergency</Text> : null}
              <Text style={[s.heroTitle, hospName && { fontSize: 20, marginTop: 14 }]}>{hero.title}</Text>
              <Text style={s.heroSub}>{hero.sub.replace('the hospital', hospName || 'the hospital')}</Text>

              {eta != null && (st.phase === 'coming' || st.phase === 'withyou') ? (
                <View style={s.etaRow}>
                  <View style={s.etaBox}>
                    <Text style={s.etaNum}>{eta}</Text>
                    <Text style={s.etaUnit}>min</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.etaLabel}>{st.phase === 'coming' ? (self ? 'until the ambulance reaches you' : 'until the ambulance arrives') : `to ${hospName || 'the hospital'}`}</Text>
                    <Text style={s.etaSub}>Updated over the mesh{st.etaAt && now ? ` · ${Math.max(0, Math.round((now - st.etaAt.at) / 1000))} s ago` : ''}</Text>
                  </View>
                  <Ambulance size={30} color="#fde68a" />
                </View>
              ) : null}
            </LinearGradient>

            {you || st.amb || hosp ? (
              <View style={{ marginTop: 14 }}>
                <OfflineMap geo={geo} you={you} amb={st.amb} hosp={hosp} phase={st.ambPhase} width={width - 40} height={250} />
                <View style={s.mapNote}>
                  <Radio size={12} color={c.dim} />
                  <Text style={s.mapNoteText}>Offline map · ambulance position arrives over the mesh{st.amb ? '' : ' once one is assigned'}</Text>
                </View>
              </View>
            ) : null}

            <View style={s.card}>
              <View style={s.row}>
                <View style={s.icon}><Phone size={16} color={c.sky} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{contactName ? `${contactName}` : 'No emergency contact'}</Text>
                  <Text style={s.rowSub}>
                    {!contactName ? 'Add one in My ID so someone is told where you are taken.'
                      : st.contact?.sent ? 'Texted by the command centre with the hospital and updates ✓'
                        : st.contact ? 'Will be texted the hospital and updates as soon as the command centre has a connection'
                          : 'Gets a text with the hospital once an ambulance is assigned'}
                  </Text>
                </View>
                {st.contact?.sent ? <CircleCheck size={18} color={c.green} /> : <Clock size={16} color={c.dim} />}
              </View>
            </View>

            <Text style={s.label}>WHAT HAS HAPPENED</Text>
            <View style={s.card}>
              {st.timeline.map((e, i) => (
                <View key={`${e.at}-${i}`} style={s.tl}>
                  <View style={[s.tlDot, i === st.timeline.length - 1 && { backgroundColor: c.green }]} />
                  <Text style={s.tlTime}>{clock(e.at)}</Text>
                  <Text style={s.tlText}>{e.text}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {supply ? (
          <>
            <Text style={s.label}>MEDICINE & SUPPLIES</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push('/medicine')} style={s.card}>
              <View style={s.row}>
                <View style={s.icon}><Pill size={16} color={c.amber} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{supplyAns ? 'Answer received' : 'Waiting for pharmacies'}</Text>
                  <Text style={s.rowSub} numberOfLines={2}>{supplyAns ? supplyAns.f.slice(4).join('|') : 'Tap to see the request'}</Text>
                </View>
              </View>
            </Pressable>
          </>
        ) : null}

        <Text style={s.label}>MESSAGES FROM THE COMMAND CENTRE</Text>
        <View style={s.card}>
          {alerts.length ? alerts.map((m) => (
            <View key={m.at + m.text} style={s.row}>
              <View style={s.icon}>{m.code === 'X' ? <BellRing size={16} color={c.amber} /> : <MessageSquareText size={16} color={c.sky} />}</View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{m.code === 'X' ? `${m.f[0].charAt(0) + m.f[0].slice(1).toLowerCase()} alert${m.f[2] ? ` · ${m.f[2]}` : ''}` : m.f.slice(2).join('|')}</Text>
                <Text style={s.rowSub}>{clock(m.at)}</Text>
              </View>
            </View>
          )) : (
            <View style={s.row}>
              <View style={s.icon}><HeartHandshake size={16} color={c.dim} /></View>
              <Text style={[s.rowSub, { flex: 1 }]}>No messages yet. Evacuation notices and updates for your area appear here, even without internet.</Text>
            </View>
          )}
        </View>
        <Text style={[s.mapNoteText, { textAlign: 'center', marginTop: 12, fontFamily: mono }]}>{link.kind === 'wifi-sim' ? 'test mesh · wi-fi' : 'mesh'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
