import { StyleSheet } from 'react-native';
import { c, mono } from './theme';

export default StyleSheet.create({
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.panel2, borderWidth: 1, borderColor: c.line },
  fileIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(56,189,248,0.12)' },
  privacy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(52,211,153,0.06)' },
  privacyText: { color: '#c7f0de', fontSize: 12.5, lineHeight: 18, flex: 1 },

  scan: { marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: c.panel2, borderWidth: 1, borderColor: c.line, gap: 9 },
  scanTrack: { height: 3, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 4 },
  scanBar: { width: 110, height: 3, borderRadius: 3, backgroundColor: c.violet },
  stage: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 2.5, backgroundColor: 'rgba(255,255,255,0.15)' },
  dotOn: { backgroundColor: c.violet },
  stageText: { color: c.dim, fontSize: 13 },

  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  source: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.4)', backgroundColor: 'rgba(167,139,250,0.1)', marginTop: 4,
  },
  sourceText: { color: '#ddd6fe', fontSize: 11, fontWeight: '700' },

  group: { marginTop: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 12, padding: 13, borderRadius: 16, backgroundColor: c.panel2, borderWidth: 1, borderColor: c.line },
  rowOn: { borderColor: 'rgba(56,189,248,0.45)', backgroundColor: 'rgba(56,189,248,0.07)' },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: c.line2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkOn: { backgroundColor: c.blue6, borderColor: c.sky4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { color: c.ink, fontSize: 15, fontWeight: '700', flex: 1 },
  strike: { textDecorationLine: 'line-through', color: c.muted },
  note: { color: c.muted, fontSize: 12.5, marginTop: 3 },
  quote: { flexDirection: 'row', gap: 6, marginTop: 7, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: 'rgba(167,139,250,0.5)' },
  quoteText: { color: '#c4b5fd', fontSize: 12, fontFamily: mono, flex: 1, lineHeight: 17 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, fontFamily: mono },
  applyBtn: { flex: 1, marginTop: 0, minHeight: 54, borderRadius: 16 },
});
