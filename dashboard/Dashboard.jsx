import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect } from 'expo-router';
import {
  Activity, ChevronRight, CircleCheck, CloudLightning, CloudRain, Construction, Flame, HeartHandshake, HeartPulse, LogOut, Phone, Pill, Radio,
  Server, ShieldCheck, Siren, Smartphone, Snowflake, Sun, Users, Waves,
} from 'lucide-react-native';
import WeatherBackdrop from './WeatherBackdrop';
import Shield, { STATUS_COLOR } from './Shield';
import HoldCard from './HoldCard';
import SosOrb from './SosOrb';
import s from './Dashboard.styles';
import { ago, DEMO_ORDER, getHazard, HAZARDS, setDemoHazard } from './hazardService';
import { around, DEFAULT_POS } from './sites';
import { latest } from './outbox';
import { c } from '../medmesh-id/theme';
import { useAuth } from '../auth/AuthContext';
import { loadProfile } from '../medmesh-id/profileService';
import { createScene, isOpen, loadScene } from '../emergency/sceneService';
import { forId, useMesh } from '../link/meshLink';

const HAZARD_ICON = { storm: CloudLightning, rain: CloudRain, flood: Waves, snow: Snowflake, fire: Flame, quake: Activity, calm: Sun };

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const initials = (n) => (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '•';

function parseContact(raw) {
  if (!raw || /^none$/i.test(raw.trim())) return null;
  const name = raw.split(/[,;\n]| - |\d/)[0].trim();
  return name ? { name, first: name.split(' ')[0] } : null;
}

export default function Dashboard() {
  const { width } = useWindowDimensions();
  const { account, signOut } = useAuth();
  const [profile, setProfile] = useState(null);
  const [hazard, setHazard] = useState(() => ({ kind: 'calm', source: 'Checking…', at: Date.now() }));
  const [request, setRequest] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const [flashAt, setFlashAt] = useState(0);
  const [showWhy, setShowWhy] = useState(false);
  const [error, setError] = useState('');
  const opening = useRef(false);
  const [shake] = useState(() => new Animated.Value(0));

  const refresh = useCallback(() => {
    loadProfile().then(setProfile).catch(() => {});
    loadScene().then((r) => setRequest(isOpen(r) ? r : null)).catch(() => {});
    latest('checkin').then((x) => setCheckin(x && Date.now() - x.at < 12 * 3600 * 1000 ? x : null));
    getHazard().then(setHazard).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    refresh();
    const t = setInterval(() => getHazard().then(setHazard).catch(() => {}), 60000);
    return () => clearInterval(t);
  }, [refresh]));

  // earthquake: the shield trembles now and then
  useEffect(() => {
    if (hazard.kind !== 'quake') return undefined;
    const id = setInterval(() => {
      Animated.sequence([4, -4, 3, -3, 2, 0].map((v) => Animated.timing(shake, { toValue: v, duration: 55, useNativeDriver: true }))).start();
    }, 5200);
    return () => clearInterval(id);
  }, [hazard.kind, shake]);

  const onFlash = useCallback(() => setFlashAt(Date.now()), []);
  const { link, inbox } = useMesh();

  const d = profile?.details || {};
  const name = (d.name || account?.name || '').split(' ')[0];
  const contact = parseContact(d.contact);
  const pos = hazard.pos || DEFAULT_POS;
  const oxygen = /oxygen|cpap|bipap|ventilat/i.test(`${d.devices || ''} ${d.conditions || ''}`);
  const near = around(pos, { oxygen });
  const km = (x) => (x.km < 1 ? `${Math.round(x.km * 1000)} m` : `${x.km.toFixed(1)} km`);

  const status = request ? 'help' : checkin ? 'safe' : 'calm';
  const col = STATUS_COLOR[status];

  // Everything that can help this person, placed around the Shield by real compass direction and distance
  const places = useMemo(() => [
    ...near.care.map((x) => ({ label: x.short, sub: km(x), glyph: x.kind === 'clinic' ? 'FC' : '+', color: c.redl, bearing: x.bearing, km: x.km })),
    ...near.rx.map((x) => ({ label: x.short, sub: km(x), glyph: 'Rx', color: c.amber, bearing: x.bearing, km: x.km })),
    ...near.o2.map((x) => ({ label: 'Oxygen supplier', sub: km(x), glyph: 'O2', color: c.sky4, bearing: x.bearing, km: x.km })),
    near.node && { label: near.node.name, sub: km(near.node), glyph: 'M', color: c.violet, bearing: near.node.bearing, km: near.node.km },
  ].filter(Boolean), [near]);

  const contacts = contact ? [{ name: contact.name, initials: initials(contact.name), told: status === 'safe' && checkin?.status === 'acked' }] : [];

  async function startSos(mode) {
    if (opening.current) return;
    opening.current = true;
    setError('');
    try {
      const r = await createScene(mode);
      setRequest(r);
      router.push('/sos');
    } catch {
      setError('Could not save your request on this phone. Nothing was sent. Please try again.');
    } finally {
      opening.current = false;
    }
  }

  async function cycleHazard() {
    const i = DEMO_ORDER.indexOf(hazard.kind);
    const next = DEMO_ORDER[(i + 1) % DEMO_ORDER.length];
    await setDemoHazard(next);
    setHazard(await getHazard());
  }

  async function leave() {
    await setDemoHazard(null);
    await signOut();
    router.replace('/welcome');
  }

  const HIcon = HAZARD_ICON[hazard.kind] || Sun;
  const hz = HAZARDS[hazard.kind] || HAZARDS.calm;
  const ccOnline = !!hazard.ccOnline || (link.kind === 'wifi-sim' && link.connected);
  const reqIds = request ? [...Object.values(request.sent || {}), request.voiceId].filter(Boolean) : [];
  const lastHelp = reqIds.flatMap((id) => forId(inbox, id)).filter((m) => m.code === 'H').sort((a, b) => a.at - b.at).pop();
  const withAmb = new Set(reqIds.filter((id) => forId(inbox, id).some((m) => m.code === 'H' && m.f[1] === 'AMB')));
  const helpText = withAmb.size > 1 ? `Ambulances assigned for ${withAmb.size} people. Stay where you are.` : lastHelp ? lastHelp.f.slice(3).join('|') : '';

  const headline = {
    calm: ["Don't worry,", "we've got you."],
    help: lastHelp ? ['Help is', 'on the way.'] : ['Your request', request?.phase === 'sent' ? 'is out.' : 'is open.'],
    safe: ["You're marked", 'safe.'],
  }[status];
  const subline = {
    calm: 'Your MedMesh ID is ready. If anything happens, hold a button below. It works without internet.',
    help: helpText || (request?.phase === 'sent' ? 'Sent. Waiting for the command centre to reply. Keep the app open.' : 'Finish the report so help can be sent. Keep the app open.'),
    safe: contact ? `${contact.first} will be told as soon as the message gets through.` : 'Your check-in is queued for the command centre.',
  }[status];

  return (
    <View style={s.screen}>
      <StatusBar style="light" />
      <WeatherBackdrop kind={hazard.kind} onFlash={onFlash} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {/* header */}
          <View style={s.header}>
            <View style={[s.avatar, { borderColor: col + '88' }]}>
              <Text style={s.avatarText}>{initials(d.name || account?.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.greet}>{greeting()},</Text>
              <Text style={s.name} numberOfLines={1}>{name || 'there'}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={leave} hitSlop={10} style={s.iconBtn}>
              <LogOut size={17} color={c.muted} />
            </Pressable>
          </View>

          {/* hazard */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${hz.label}. Source: ${hazard.source}. Tap for details.`}
            onPress={() => setShowWhy((v) => !v)}
            onLongPress={cycleHazard}
            delayLongPress={600}
            style={({ pressed }) => [s.hazard, hazard.kind !== 'calm' && s.hazardOn, pressed && { opacity: 0.85 }]}
          >
            <View style={[s.hazardIcon, hazard.kind !== 'calm' && { backgroundColor: 'rgba(251,191,36,0.16)' }]}>
              <HIcon size={16} color={hazard.kind === 'calm' ? c.sky : c.amber} strokeWidth={2.3} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.hazardTitle}>{hz.label}{hazard.area ? ` · ${hazard.area}` : ''}</Text>
              <Text style={s.hazardSub} numberOfLines={1}>{hazard.source} · {ago(hazard.at)}</Text>
            </View>
            {hazard.demo ? <Text style={s.demoTag}>DEMO</Text> : null}
          </Pressable>
          {showWhy ? (
            <Text style={s.why}>
              MedMesh shows a disaster only when it has a source: the command centre (also sent over the mesh, so it works
              offline), live weather at your GPS location, or the last alert saved on this phone. Otherwise it stays neutral.
            </Text>
          ) : null}

          {/* shield */}
          <Animated.View style={{ marginHorizontal: -20, marginTop: 4, transform: [{ translateX: shake }] }}>
            <Shield
              width={width}
              height={Math.min(300, width * 0.76)}
              status={status}
              kind={hazard.kind}
              flashAt={flashAt}
              signal={ccOnline ? 0.9 : 0.35}
              places={places}
              contacts={contacts}
            />
          </Animated.View>

          <View style={s.statusPill}>
            <View style={[s.dot, { backgroundColor: col }]} />
            <Text style={[s.statusText, { color: col }]}>
              {status === 'help' ? (lastHelp ? 'HELP ON THE WAY' : 'EMERGENCY REPORT OPEN') : status === 'safe' ? 'CHECKED IN SAFE' : 'PROTECTED · READY'}
            </Text>
          </View>
          <Text style={s.headline}>{headline[0]}{'\n'}<Text style={{ color: col }}>{headline[1]}</Text></Text>
          <Text style={s.subline}>{subline}</Text>

          {/* active request */}
          {request ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/sos')} style={({ pressed }) => [s.resume, pressed && { opacity: 0.85 }]}>
              <Siren size={18} color={c.amber} />
              <View style={{ flex: 1 }}>
                <Text style={s.resumeTitle}>{request.mode === 'self' ? 'Your emergency report' : `Report for ${Math.max(request.count || 1, (request.people || []).length) > 1 ? `${Math.max(request.count, request.people.length)} people` : 'someone else'}`}</Text>
                <Text style={s.resumeSub}>{helpText || (request.phase === 'sent' ? 'Sent · tap to see status' : 'Not finished · tap to continue')}</Text>
              </View>
              <ChevronRight size={18} color={c.amber} />
            </Pressable>
          ) : null}

          {/* actions */}
          <Text style={s.sectionLabel}>WHAT DO YOU NEED?</Text>
          <SosOrb size={Math.min(240, width * 0.62)} disabled={!!request} onComplete={() => startSos('self')} />
          <View style={{ height: 14 }} />
          <HoldCard
            title="Someone else needs help"
            sub="Hold 3 seconds · SOS for another person"
            icon={Users}
            colors={['#1e3a8a', '#0f172a']}
            accent="#bfdbfe"
            disabled={!!request}
            onComplete={() => startSos('other')}
          />
          <View style={s.tiles}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/medicine')} style={({ pressed }) => [s.tile, pressed && s.pressed]}>
              <View style={[s.tileIcon, { backgroundColor: 'rgba(251,191,36,0.14)' }]}><Pill size={20} color={c.amber} /></View>
              <Text style={s.tileTitle}>Medicine & supplies</Text>
              <Text style={s.tileSub}>Medicine, oxygen, equipment</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push('/safe')} style={({ pressed }) => [s.tile, pressed && s.pressed, status === 'safe' && s.tileSafe]}>
              <View style={[s.tileIcon, { backgroundColor: 'rgba(52,211,153,0.14)' }]}>
                {status === 'safe' ? <CircleCheck size={20} color={c.green} /> : <HeartHandshake size={20} color={c.green} />}
              </View>
              <Text style={s.tileTitle}>{"I'm safe"}</Text>
              <Text style={s.tileSub}>{status === 'safe' ? `Checked in ${ago(checkin.at)}` : 'Tell my people'}</Text>
            </Pressable>
          </View>
          <View style={[s.tiles, { marginTop: 10 }]}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/guides')} style={({ pressed }) => [s.tile, pressed && s.pressed]}>
              <View style={[s.tileIcon, { backgroundColor: 'rgba(244,63,94,0.14)' }]}><HeartPulse size={20} color={c.redl} /></View>
              <Text style={s.tileTitle}>First aid</Text>
              <Text style={s.tileSub}>CPR coach, guides in your language</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push('/road')} style={({ pressed }) => [s.tile, pressed && s.pressed]}>
              <View style={[s.tileIcon, { backgroundColor: 'rgba(56,189,248,0.14)' }]}><Construction size={20} color={c.sky} /></View>
              <Text style={s.tileTitle}>Report a road</Text>
              <Text style={s.tileSub}>Blocked, flooded, debris</Text>
            </Pressable>
          </View>
          {error ?<Text style={s.error} accessibilityRole="alert">{error}</Text> : null}

          {/* contact */}
          <Pressable accessibilityRole="button" onPress={() => router.push('/profile')} style={({ pressed }) => [s.contact, pressed && s.pressed]}>
            <View style={s.contactIcon}><Phone size={16} color={c.sky} /></View>
            <Text style={s.contactText}>
              {contact
                ? <>{"If you're taken to hospital, "}<Text style={s.ink}>{contact.name}</Text>{' is told which one and when, automatically.'}</>
                : <>{"Add an emergency contact to your MedMesh ID so they're told which hospital you go to."}</>}
            </Text>
            <ChevronRight size={16} color={c.dim} />
          </Pressable>

          {/* link status */}
          <View style={s.link}>
            <LinkStep icon={Smartphone} label="Phone" state="ok" />
            <View style={s.linkBar} />
            <LinkStep icon={Radio} label={link.kind === 'wifi-sim' ? 'Test mesh' : 'Mesh node'} state={link.kind === 'wifi-sim' && link.connected ? 'ok' : 'off'} />
            <View style={s.linkBar} />
            <LinkStep icon={Server} label="Command centre" state={ccOnline ? 'ok' : 'off'} />
          </View>
          <View style={s.linkNote}>
            <ShieldCheck size={13} color={c.dim} />
            <Text style={s.linkNoteText}>
              {ccOnline ? 'Command centre reachable. ' : ''}Requests are saved on this phone first and sent over the mesh when a node is in range.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function LinkStep({ icon: Icon, label, state }) {
  const color = state === 'ok' ? c.green : c.dim;
  return (
    <View style={s.linkStep}>
      <View style={[s.linkIcon, { borderColor: color + '66' }]}><Icon size={14} color={color} /></View>
      <Text style={[s.linkLabel, { color: state === 'ok' ? c.ink : c.dim }]}>{label}</Text>
    </View>
  );
}
