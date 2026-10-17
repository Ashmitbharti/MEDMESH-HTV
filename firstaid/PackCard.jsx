import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { CircleCheck, Languages, RefreshCw, Sparkles } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { GUIDES, LANGUAGES } from './content';
import { buildPack } from './pack';
import { useClock } from '../ui3d/project';

// "Your emergency pack": pick a language, Gemini prepares every guide + the CPR voice, saved for offline use.
// While building, the guides orbit and fly into a shield (3D-style), then the shield settles with a check.

const TINTS = Object.values(GUIDES).map((g) => g.tint);

function Assemble({ stage, width = 300, height = 150 }) {
  const { t } = useClock(true, 30);
  const cx = width / 2;
  const cy = height / 2 + 6;
  const done = stage === 'done';
  const pull = stage === 'saving' ? 0.45 : done ? 1 : 0;
  return (
    <Svg width={width} height={height}>
      <Ellipse cx={cx} cy={cy + 46} rx={110} ry={16} fill="#38bdf8" fillOpacity={0.08} stroke="#38bdf8" strokeOpacity={0.3} />
      {!done ? TINTS.map((tint, i) => {
        const a = t * 1.4 + (i / TINTS.length) * Math.PI * 2;
        const r = 100 * (1 - pull);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.32;
        const front = Math.sin(a) > 0;
        return <Rect key={i} x={x - 9} y={y - 12} width={18} height={24} rx={4} fill={tint} fillOpacity={front ? 0.95 : 0.4} transform={`rotate(${Math.cos(a) * 20} ${x} ${y})`} />;
      }) : null}
      <G opacity={0.5 + (done ? 0.5 : 0.25 * Math.sin(t * 4) + 0.25)}>
        <Path d={`M${cx},${cy - 40} l34,12 v22 c0,22 -16,34 -34,42 c-18,-8 -34,-20 -34,-42 v-22 z`} fill={done ? '#065f46' : '#0b1730'} stroke={done ? c.green : c.sky} strokeWidth={2} />
        {done ? <Path d={`M${cx - 13},${cy} l9,9 l18,-20`} stroke="#fff" strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          : <Circle cx={cx} cy={cy} r={6 + 2 * Math.sin(t * 5)} fill={c.violet} />}
      </G>
    </Svg>
  );
}

export default function PackCard({ details, pack, onBuilt, compact }) {
  const [lang, setLang] = useState(pack?.language || details?.language || 'English');
  const [stage, setStage] = useState('');
  const busy = stage && stage !== 'done';

  async function build() {
    setStage('translating');
    try {
      const p = await buildPack(details || {}, lang, setStage);
      onBuilt?.(p);
    } finally {
      setTimeout(() => setStage(''), 1600);
    }
  }

  const voiced = pack ? Object.keys(pack.audio || {}).length : 0;
  return (
    <View style={{ marginTop: 16, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(167,139,250,0.35)' }}>
      <LinearGradient colors={['rgba(139,92,246,0.18)', 'rgba(11,16,32,0.95)']} style={{ padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color={c.violet} />
          <Text style={{ color: '#ddd6fe', fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '800', flex: 1 }}>YOUR EMERGENCY PACK</Text>
          {pack ? <Text style={{ color: pack.source === 'gemini' ? c.violet : c.dim, fontFamily: mono, fontSize: 10, fontWeight: '800' }}>{pack.source === 'gemini' ? 'GEMINI' : 'ENGLISH'}</Text> : null}
        </View>
        {busy || stage === 'done' ? (
          <View style={{ alignItems: 'center', marginTop: 6 }}>
            <Assemble stage={stage} />
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '800' }}>
              {stage === 'translating' ? `Gemini is preparing your guides in ${lang.replace(/^[^A-Za-z]+\s/, '')}…` : stage === 'saving' ? 'Saving voice and guides on this phone…' : 'Ready. Works without internet.'}
            </Text>
            <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 4, textAlign: 'center' }}>Every line is translated back to English and its numbers are checked.</Text>
          </View>
        ) : (
          <>
            <Text style={{ color: c.ink, fontSize: compact ? 16 : 19, fontWeight: '800', marginTop: 8 }}>
              {pack ? `First aid in ${pack.languageName}, ready offline` : 'First aid in your language, ready before you need it'}
            </Text>
            <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 4 }}>
              {pack
                ? `${pack.guides.length} guides${voiced ? ` · ${voiced} lines in a natural voice` : ''}${pack.checks ? ` · ${pack.checks.passed} lines checked${pack.checks.fallback.length ? `, ${pack.checks.fallback.length} kept in English` : ''}` : ''}. Matched to your MedMesh ID.`
                : 'While you have internet, Gemini translates and voices CPR, bleeding, choking and more, matched to your MedMesh ID. Then it all works offline.'}
            </Text>
            {pack?.error ? <Text style={{ color: c.amber, fontSize: 12.5, marginTop: 6 }}>{pack.error}</Text> : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 6 }}>
              {LANGUAGES.map(([label]) => (
                <Pressable key={label} accessibilityRole="radio" accessibilityState={{ checked: lang === label }} onPress={() => setLang(label)}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: lang === label ? c.violet : c.line2, backgroundColor: lang === label ? 'rgba(167,139,250,0.18)' : c.panel2 }}>
                  <Text style={{ color: lang === label ? '#ede9fe' : '#d1d5db', fontSize: 13.5, fontWeight: '700' }}>{label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={build} style={({ pressed }) => [{ marginTop: 12, borderRadius: 16, overflow: 'hidden' }, pressed && { opacity: 0.85 }]}>
              <LinearGradient colors={['#8b5cf6', '#2563eb']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {pack ? <RefreshCw size={17} color="#fff" /> : <Languages size={17} color="#fff" />}
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{pack ? (pack.language === lang ? 'Update my pack' : 'Rebuild in this language') : 'Build my emergency pack'}</Text>
              </LinearGradient>
            </Pressable>
            {pack ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
                <CircleCheck size={13} color={c.green} />
                <Text style={{ color: c.dim, fontSize: 12 }}>Saved {new Date(pack.builtAt).toLocaleDateString()} · Gemini never writes medical advice; it translates our checked guides.</Text>
              </View>
            ) : null}
          </>
        )}
      </LinearGradient>
    </View>
  );
}
