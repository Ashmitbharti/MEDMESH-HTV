import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { c, mono } from '../medmesh-id/theme';

// The mitigation deck as swipeable 3D cards: the card in front faces you, its neighbours turn away like pages.
// Every action shows the facts it is based on (area / need / node keys); actions citing nothing real were dropped.

const WHEN = { before: '#38bdf8', during: '#f43f5e', after: '#a78bfa' };

export default function MitigationDeck({ deck, width }) {
  const [x, setX] = useState(0);
  const w = width - 40;
  const cards = [{ cover: true }, ...deck.slides];
  const page = Math.round(x / (w + 12));
  return (
    <View style={{ marginTop: 12 }}>
      <ScrollView horizontal pagingEnabled={false} snapToInterval={w + 12} decelerationRate="fast" showsHorizontalScrollIndicator={false}
        onScroll={(e) => setX(e.nativeEvent.contentOffset.x)} scrollEventThrottle={16} contentContainerStyle={{ gap: 12 }}>
        {cards.map((s, i) => {
          const off = (i * (w + 12) - x) / (w + 12);                 // -1 … 0 … 1
          const rot = Math.max(-1, Math.min(1, off)) * 28;
          return (
            <View key={i} style={{ width: w, minHeight: 360, padding: 18, borderRadius: 24, backgroundColor: s.cover ? '#1e1b4b' : c.panel, borderWidth: 1,
              borderColor: s.cover ? 'rgba(167,139,250,0.6)' : c.line2, transform: [{ perspective: 900 }, { rotateY: `${-rot}deg` }, { scale: 1 - Math.min(0.08, Math.abs(off) * 0.08) }],
              opacity: 1 - Math.min(0.5, Math.abs(off) * 0.5) }}>
              {s.cover ? (
                <>
                  <Text style={{ color: c.violet, fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>MITIGATION DECK · {deck.source === 'gemini' ? 'GEMINI' : 'RULES'}</Text>
                  <Text style={{ color: c.ink, fontSize: 24, lineHeight: 29, fontWeight: '900', marginTop: 14 }}>{deck.headline}</Text>
                  <Text style={{ color: c.muted, fontSize: 14, lineHeight: 21, marginTop: 12 }}>{deck.summary}</Text>
                  <Text style={{ color: c.dim, fontSize: 12, marginTop: 'auto', paddingTop: 16 }}>
                    {deck.slides.length} slides · made {deck.generated?.replace('T', ' ')}{deck.dropped ? ` · ${deck.dropped} unsupported action(s) removed` : ''} · swipe →
                  </Text>
                </>
              ) : (
                <>
                  <Text style={{ color: c.violet, fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>{i} / {deck.slides.length}{s.area ? ` · ${s.area.replace('area:', '')}` : ' · CITY-WIDE'}</Text>
                  <Text style={{ color: c.ink, fontSize: 19, lineHeight: 24, fontWeight: '900', marginTop: 8 }}>{s.title}</Text>
                  <Text style={{ color: '#fecdd3', fontSize: 13, lineHeight: 19, marginTop: 8 }}>{s.problem}</Text>
                  {s.actions.map((a, j) => (
                    <View key={j} style={{ marginTop: 10, padding: 11, borderRadius: 14, backgroundColor: c.panel2, borderLeftWidth: 3, borderLeftColor: WHEN[a.when] || c.sky }}>
                      <Text style={{ color: c.ink, fontSize: 13.5, lineHeight: 19, fontWeight: '600' }}>{a.action}</Text>
                      <Text style={{ color: c.dim, fontSize: 11.5, marginTop: 4 }}>
                        <Text style={{ color: WHEN[a.when] || c.sky, fontWeight: '800' }}>{(a.when || '').toUpperCase()}</Text> · {a.owner} · <Text style={{ fontFamily: mono }}>{(a.evidence || []).join(', ')}</Text>
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}>
        {cards.map((_, i) => <View key={i} style={{ width: i === page ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? c.violet : c.line2 }} />)}
      </View>
    </View>
  );
}
