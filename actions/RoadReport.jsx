import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { ChevronLeft, CircleCheck, Clock, Construction, Flame, LocateFixed, MapPin, Send, TriangleAlert, Waves } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import OfflineMap from '../map/OfflineMap';
import { loadMap } from '../map/mapData';
import { nearestRoad } from '../map/geoUtils';
import { getPosition } from '../dashboard/hazardService';
import { DEFAULT_POS } from '../dashboard/sites';
import { newId, queue } from '../dashboard/outbox';
import { forId, useMesh } from '../link/meshLink';
import LinkBanner from '../components/LinkBanner';

// RD|id|BLOCK/FLOOD/DEBRIS/FIRE|lat,lon|road   one report slows the road for ambulances; a second person, a responder
// or a sensor confirms it and the road is closed (or the flood zone applied). The command centre reroutes every ambulance.
const KINDS = {
  BLOCK: { label: 'Blocked', sub: 'Can’t get through', icon: Construction, tint: '#f43f5e' },
  FLOOD: { label: 'Flooded', sub: 'Water on the road', icon: Waves, tint: '#38bdf8' },
  DEBRIS: { label: 'Debris / slow', sub: 'Passable with care', icon: TriangleAlert, tint: '#fbbf24' },
  FIRE: { label: 'Fire', sub: 'Smoke or flames', icon: Flame, tint: '#fb923c' },
};

export default function RoadReport() {
  const { width } = useWindowDimensions();
  const { link, inbox, outbox } = useMesh();
  const [geo, setGeo] = useState(null);
  const [me, setMe] = useState(null);
  const [pin, setPin] = useState(null);
  const [kind, setKind] = useState(null);
  const [sent, setSent] = useState([]);

  useEffect(() => { loadMap().then(setGeo); }, []);
  useFocusEffect(useCallback(() => {
    getPosition().then((p) => { const pos = p || DEFAULT_POS; setMe(pos); setPin((cur) => cur || pos); });
  }, []));

  const road = geo && pin ? nearestRoad(geo, pin.lat, pin.lon, 700) : null;
  const frame = me ? { lat: me.lat, lon: me.lon, span: 1800 } : null;
  const mapW = width - 40;

  async function send() {
    const id = newId();
    const item = await queue('road', `RD|${id}|${kind}|${pin.lat.toFixed(5)},${pin.lon.toFixed(5)}|${road?.name || ''}`, { road: road?.name || '', kind });
    setSent((v) => [item, ...v]);
    setKind(null);
  }

  const statusOf = (o) => {
    const ra = forId(inbox, o.id).filter((m) => m.code === 'RA').pop();
    if (ra?.f[1] === 'CONFIRMED') return { done: true, text: `Confirmed by ${ra.f[2]} reports. Ambulances are routed around it.` };
    if (ra) return { done: false, text: 'Received. Ambulances avoid it for now. One more report (or a sensor) confirms it.' };
    const ob = outbox.find((x) => x.id === o.id);
    return { done: false, text: ob?.status === 'acked' ? 'Received by the command centre.' : 'Saved · sends when a node is in range.' };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <LinearGradient colors={['rgba(56,189,248,0.18)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 300 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 }}>
          <ChevronLeft size={18} color={c.muted} /><Text style={{ color: c.muted, fontWeight: '600' }}>Home</Text>
        </Pressable>
        <LinkBanner link={link} ids={sent.map((x) => x.id)} outbox={outbox} />
        <Text style={{ color: c.sky, fontFamily: mono, fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 12 }}>REPORT A ROAD</Text>
        <Text style={{ color: c.ink, fontSize: 28, lineHeight: 33, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 }}>Help ambulances{'\n'}find a way through.</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          {Object.entries(KINDS).map(([k, v]) => {
            const on = kind === k;
            const I = v.icon;
            return (
              <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={v.label} onPress={() => setKind(k)}
                style={({ pressed }) => [{ width: (width - 50) / 2, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: on ? v.tint : c.line, backgroundColor: on ? v.tint + '22' : c.panel }, pressed && { opacity: 0.85 }]}>
                <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: v.tint + '22', transform: [{ perspective: 300 }, { rotateX: on ? '0deg' : '18deg' }] }}>
                  <I size={20} color={v.tint} />
                </View>
                <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: '800', marginTop: 10 }}>{v.label}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>{v.sub}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={{ color: c.sky, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700', marginTop: 22, marginBottom: 10 }}>WHERE? TAP THE MAP TO MOVE THE PIN</Text>
        <View style={{ transform: [{ perspective: 1000 }, { rotateX: '16deg' }], marginTop: -6 }}>
          {frame ? <OfflineMap geo={geo} you={me} pin={pin} frame={frame} onPick={setPin} width={mapW} height={260} /> : <View style={{ height: 260 }} />}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <MapPin size={16} color={c.redl} />
          <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700', flex: 1 }}>{road ? `${road.name}${road.dist > 30 ? ` · ${road.dist} m away` : ''}` : 'No named road nearby'}</Text>
          <Pressable accessibilityRole="button" onPress={() => me && setPin(me)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: c.line2 }}>
            <LocateFixed size={14} color={c.sky} /><Text style={{ color: c.sky, fontSize: 12.5, fontWeight: '700' }}>Where I am</Text>
          </Pressable>
        </View>

        <Pressable accessibilityRole="button" disabled={!kind || !pin} onPress={send} style={({ pressed }) => [{ marginTop: 18, borderRadius: 18, overflow: 'hidden' }, (!kind || !pin) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}>
          <LinearGradient colors={['#38bdf8', '#2563eb']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Send size={18} color="#fff" /><Text style={{ color: '#fff', fontSize: 16.5, fontWeight: '800' }}>{kind ? `Report ${KINDS[kind].label.toLowerCase()} road` : 'Choose what is wrong'}</Text>
          </LinearGradient>
        </Pressable>
        <Text style={{ color: c.dim, fontSize: 12, lineHeight: 17, marginTop: 8 }}>
          One report makes ambulances avoid the road. When a second person, a responder or a sensor confirms it, the road is closed for routing.
        </Text>

        {sent.map((o) => {
          const st = statusOf(o);
          return (
            <View key={o.id} style={{ flexDirection: 'row', gap: 10, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: c.panel, borderWidth: 1, borderColor: st.done ? 'rgba(52,211,153,0.45)' : c.line }}>
              {st.done ? <CircleCheck size={18} color={c.green} /> : <Clock size={18} color={c.amber} />}
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.ink, fontSize: 14.5, fontWeight: '700' }}>{KINDS[o.kind]?.label} · {o.road || 'marked spot'}</Text>
                <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 2, lineHeight: 18 }}>{st.text}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
