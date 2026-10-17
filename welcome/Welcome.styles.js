import { Platform, StyleSheet } from 'react-native';
import { c, mono } from '../medmesh-id/theme';

const glowShadow = Platform.select({
  web: { boxShadow: '0 14px 30px -12px rgba(37,99,235,0.7)' },
  default: { shadowColor: '#2563eb', shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
});

export default StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  content: { paddingHorizontal: 20, paddingBottom: 48 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  logo: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  brand: { color: c.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, flex: 1 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(52,211,153,0.35)' },
  offlineText: { color: c.green, fontSize: 11.5, fontWeight: '700' },
  dragHint: { color: c.dim, fontFamily: mono, fontSize: 10, letterSpacing: 1.6, textAlign: 'center', marginTop: -10, textTransform: 'uppercase' },
  title: { color: c.ink, fontSize: 29, lineHeight: 35, fontWeight: '800', letterSpacing: -0.6, marginTop: 18 },
  sub: { color: c.muted, fontSize: 14.5, lineHeight: 22, marginTop: 10 },

  card: { marginTop: 22, padding: 16, borderRadius: 24, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line },
  cardLabel: { color: c.sky, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700', marginBottom: 10 },
  seg: { flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: c.panel2, borderWidth: 1, borderColor: c.line, gap: 4, marginBottom: 6 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12 },
  segOn: { backgroundColor: 'rgba(56,189,248,0.16)', borderWidth: 1, borderColor: 'rgba(56,189,248,0.5)' },
  segText: { color: c.muted, fontSize: 13.5, fontWeight: '700' },
  segTextOn: { color: '#e0f2fe' },
  input: { marginTop: 10, minHeight: 52, paddingHorizontal: 16, color: c.ink, fontSize: 16, backgroundColor: c.panel2, borderRadius: 15, borderWidth: 1, borderColor: c.line2 },
  err: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.08)' },
  errText: { color: c.redl, fontSize: 13, flex: 1, lineHeight: 18 },
  note: { color: c.green, fontSize: 13, marginTop: 12 },
  cta: { marginTop: 14, borderRadius: 16, overflow: 'hidden', ...glowShadow },
  ctaFill: { minHeight: 54, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  switch: { alignItems: 'center', paddingTop: 14, paddingBottom: 4 },
  switchText: { color: c.muted, fontSize: 13.5, fontWeight: '600' },

  demoLabel: { color: c.dim, fontFamily: mono, fontSize: 10, letterSpacing: 1.6, fontWeight: '700', marginTop: 24, marginBottom: 10 },
  demo: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, marginBottom: 8 },
  demoIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  demoTitle: { color: c.ink, fontSize: 15, fontWeight: '700' },
  demoSub: { color: c.dim, fontSize: 12, fontFamily: mono, marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  footerText: { color: c.dim, fontSize: 11.5 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
});
