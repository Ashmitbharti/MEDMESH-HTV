import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { ChevronLeft, HeartPulse, Volume2 } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import GuideArt from './GuideArt';
import PackCard from './PackCard';
import { GUIDES, recommended } from './content';
import { line, loadPack } from './pack';
import { loadProfile } from '../medmesh-id/profileService';
import { getHazard } from '../dashboard/hazardService';

export default function Guides() {
  const { width } = useWindowDimensions();
  const [pack, setPack] = useState(null);
  const [details, setDetails] = useState({});
  const [hazard, setHazard] = useState('calm');

  useFocusEffect(useCallback(() => {
    loadPack().then(setPack);
    loadProfile().then((p) => setDetails(p?.details || {})).catch(() => {});
    getHazard().then((h) => setHazard(h.kind)).catch(() => {});
  }, []));

  const rec = recommended(details, hazard);
  const all = Object.keys(GUIDES).filter((k) => !GUIDES[k].personal || (pack?.guides || []).includes(k) || rec.includes(k));
  const title = (k) => (pack ? line(pack, `t_${k}`) || GUIDES[k].title : GUIDES[k].title);
  const half = (width - 40 - 10) / 2;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <LinearGradient colors={['rgba(244,63,94,0.18)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 }}>
          <ChevronLeft size={18} color={c.muted} /><Text style={{ color: c.muted, fontWeight: '600' }}>Home</Text>
        </Pressable>
        <Text style={{ color: c.redl, fontFamily: mono, fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 8 }}>FIRST AID · WORKS OFFLINE</Text>
        <Text style={{ color: c.ink, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 }}>Know what to do{'\n'}until help arrives.</Text>

        <Pressable accessibilityRole="button" onPress={() => router.push('/cpr')} style={({ pressed }) => [{ marginTop: 16, borderRadius: 24, overflow: 'hidden' }, pressed && { opacity: 0.9 }]}>
          <LinearGradient colors={['#be123c', '#4c0519']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 6 }}>
            <GuideArt id="cpr" tint="#fda4af" width={130} height={112} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 21, fontWeight: '900' }}>Start CPR coach</Text>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4, lineHeight: 18 }}>Someone is not breathing. A beat to push to, and a voice{pack?.source === 'gemini' ? ` in ${pack.languageName}` : ''} talking you through it.</Text>
            </View>
            <HeartPulse size={22} color="#fff" />
          </LinearGradient>
        </Pressable>

        <Text style={{ color: c.sky, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700', marginTop: 24, marginBottom: 10 }}>RECOMMENDED FOR YOU{hazard !== 'calm' ? ` · ${hazard.toUpperCase()}` : ''}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {rec.filter((k) => k !== 'cpr').map((k) => (
            <Pressable key={k} accessibilityRole="button" accessibilityLabel={GUIDES[k].title} onPress={() => router.push(`/guide?id=${k}`)}
              style={({ pressed }) => [{ width: 200, borderRadius: 22, backgroundColor: c.panel, borderWidth: 1, borderColor: GUIDES[k].tint + '55', padding: 12 }, pressed && { opacity: 0.85 }]}>
              <GuideArt id={k} tint={GUIDES[k].tint} width={176} height={120} />
              <Text style={{ color: c.ink, fontSize: 16, fontWeight: '800' }}>{title(k)}</Text>
              <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 2 }}>{GUIDES[k].personal ? 'From your MedMesh ID' : GUIDES[k].sub}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={{ color: c.sky, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700', marginTop: 24, marginBottom: 10 }}>ALL GUIDES</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {all.map((k) => (
            <Pressable key={k} accessibilityRole="button" accessibilityLabel={GUIDES[k].title} onPress={() => router.push(k === 'cpr' ? '/cpr' : `/guide?id=${k}`)}
              style={({ pressed }) => [{ width: half, borderRadius: 20, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, padding: 10 }, pressed && { opacity: 0.85 }]}>
              <GuideArt id={k} tint={GUIDES[k].tint} width={half - 20} height={96} still />
              <Text style={{ color: c.ink, fontSize: 14.5, fontWeight: '800' }} numberOfLines={1}>{title(k)}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                {pack?.audio && GUIDES[k].steps.some(([id]) => pack.audio[id]) ? <Volume2 size={11} color={c.violet} /> : null}
                <Text style={{ color: c.dim, fontSize: 11.5 }} numberOfLines={1}>{GUIDES[k].sub}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <PackCard details={details} pack={pack} onBuilt={setPack} compact />
        <Text style={{ color: c.dim, fontSize: 11.5, lineHeight: 16, marginTop: 14 }}>
          Guides follow Canadian Red Cross and Heart & Stroke public first-aid guidance. They do not replace training or the instructions of paramedics.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
