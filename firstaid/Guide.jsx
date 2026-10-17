import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, Pause, Sparkles, Volume2 } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import GuideArt from './GuideArt';
import { GUIDES } from './content';
import { line, loadPack, tipsFor } from './pack';
import { say, stopVoice } from './voice';
import { loadProfile } from '../medmesh-id/profileService';

export default function Guide() {
  const { id = 'bleeding' } = useLocalSearchParams();
  const g = GUIDES[id] || GUIDES.bleeding;
  const { width } = useWindowDimensions();
  const [pack, setPack] = useState(null);
  const [details, setDetails] = useState({});
  const [i, setI] = useState(0);
  const [reading, setReading] = useState(false);
  const [voiceKind, setVoiceKind] = useState('');

  useFocusEffect(useCallback(() => {
    loadPack().then(setPack);
    loadProfile().then((p) => setDetails(p?.details || {})).catch(() => {});
    return () => stopVoice();
  }, []));

  const steps = g.steps;
  const [sid, en] = steps[i];
  const text = line(pack, sid) || en;
  const translated = pack?.source === 'gemini' && pack.text?.[sid] && !pack.text[sid].english;
  const tips = tipsFor(pack, id, details);

  useEffect(() => {
    if (!reading) return;
    say(pack, sid, { onDone: () => { if (i < steps.length - 1) setTimeout(() => setI((v) => v + 1), 600); else setReading(false); } })
      .then((k) => k && setVoiceKind(k));
  }, [reading, i, sid, pack, steps.length]);

  const go = (d) => { stopVoice(); setI((v) => Math.max(0, Math.min(steps.length - 1, v + d))); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <LinearGradient colors={[g.tint + '40', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 420 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <Pressable accessibilityRole="button" onPress={() => { stopVoice(); router.back(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 }}>
          <ChevronLeft size={18} color={c.muted} /><Text style={{ color: c.muted, fontWeight: '600' }}>First aid</Text>
        </Pressable>
        <Text style={{ color: g.tint, fontFamily: mono, fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 8 }}>{g.sub.toUpperCase()}</Text>
        <Text style={{ color: c.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 }}>{line(pack, `t_${id}`) || g.title}</Text>

        <View style={{ alignItems: 'center', marginTop: 6 }}>
          <GuideArt id={id} tint={g.tint} width={Math.min(width - 40, 360)} height={220} />
        </View>

        <View style={{ flexDirection: 'row', gap: 5, marginTop: 4 }}>
          {steps.map(([k], n) => <View key={k} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: n <= i ? g.tint : c.line2 }} />)}
        </View>
        <View style={{ marginTop: 14, padding: 18, borderRadius: 22, backgroundColor: c.panel, borderWidth: 1, borderColor: g.tint + '55', minHeight: 150 }}>
          <Text style={{ color: c.dim, fontFamily: mono, fontSize: 11, fontWeight: '700' }}>STEP {i + 1} OF {steps.length}</Text>
          <Text style={{ color: c.ink, fontSize: 22, lineHeight: 30, fontWeight: '700', marginTop: 8 }}>{text}</Text>
          {translated ? <Text style={{ color: c.dim, fontSize: 13, lineHeight: 19, marginTop: 8 }}>{en}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous step" disabled={i === 0} onPress={() => go(-1)}
            style={{ width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.panel2, borderWidth: 1, borderColor: c.line2, opacity: i === 0 ? 0.4 : 1 }}>
            <ChevronLeft size={22} color={c.ink} />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { if (reading) { stopVoice(); setReading(false); } else setReading(true); }}
            style={{ flex: 1, borderRadius: 18, overflow: 'hidden' }}>
            <LinearGradient colors={[g.tint, '#1e3a8a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {reading ? <Pause size={18} color="#fff" /> : <Volume2 size={18} color="#fff" />}
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{reading ? 'Stop reading' : 'Read it to me'}</Text>
            </LinearGradient>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Next step" disabled={i === steps.length - 1} onPress={() => go(1)}
            style={{ width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.panel2, borderWidth: 1, borderColor: c.line2, opacity: i === steps.length - 1 ? 0.4 : 1 }}>
            <ChevronRight size={22} color={c.ink} />
          </Pressable>
        </View>
        {reading && voiceKind ? (
          <Text style={{ color: c.dim, fontSize: 12, textAlign: 'center', marginTop: 8 }}>{voiceKind === 'gemini' ? `Gemini voice · ${pack.languageName} · saved on this phone` : 'Phone voice'}</Text>
        ) : null}

        {tips.map((tp) => (
          <View key={tp.id} style={{ flexDirection: 'row', gap: 10, marginTop: 16, padding: 14, borderRadius: 18, backgroundColor: 'rgba(167,139,250,0.08)', borderWidth: 1, borderColor: 'rgba(167,139,250,0.35)' }}>
            <Sparkles size={16} color={c.violet} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#ddd6fe', fontSize: 11, fontFamily: mono, fontWeight: '800', letterSpacing: 1.2 }}>FOR YOU · FROM YOUR MEDMESH ID</Text>
              <Text style={{ color: c.ink, fontSize: 14.5, lineHeight: 21, marginTop: 4 }}>{tp.text}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
