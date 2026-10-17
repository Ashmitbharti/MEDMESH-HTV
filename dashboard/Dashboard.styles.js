import { Platform, StyleSheet } from 'react-native';
import { c, mono } from '../medmesh-id/theme';

const lift = (color) => Platform.select({
  web: { boxShadow: `0 16px 34px -14px ${color}` },
  default: { shadowColor: color, shadowOpacity: 0.55, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
});

export default StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: 20, paddingBottom: 120 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,22,41,0.8)' },
  avatarText: { color: c.ink, fontSize: 16, fontWeight: '800' },
  greet: { color: c.muted, fontSize: 14, fontWeight: '600' },
  name: { color: c.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  iconBtn: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15,22,41,0.7)', borderWidth: 1, borderColor: c.line },

  hazard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 10, paddingRight: 14, borderRadius: 18,
    backgroundColor: 'rgba(11,16,32,0.72)', borderWidth: 1, borderColor: c.line,
  },
  hazardOn: { borderColor: 'rgba(251,191,36,0.35)' },
  hazardIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(56,189,248,0.12)' },
  hazardTitle: { color: c.ink, fontSize: 14, fontWeight: '700' },
  hazardSub: { color: c.dim, fontSize: 11.5, marginTop: 1 },
  demoTag: { color: c.violet, fontFamily: mono, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, borderWidth: 1, borderColor: 'rgba(167,139,250,0.5)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  why: { color: c.muted, fontSize: 12.5, lineHeight: 18, marginTop: 8, paddingHorizontal: 4 },

  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'center', marginTop: -6, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(11,16,32,0.75)', borderWidth: 1, borderColor: c.line },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontFamily: mono, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.6 },
  headline: { color: c.ink, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.7, textAlign: 'center', marginTop: 14 },
  subline: { color: c.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, paddingHorizontal: 8 },

  resume: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, padding: 14, borderRadius: 18, backgroundColor: 'rgba(251,191,36,0.08)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)' },
  resumeTitle: { color: '#fde68a', fontSize: 15, fontWeight: '700' },
  resumeSub: { color: c.muted, fontSize: 12, marginTop: 2 },

  sectionLabel: { color: c.sky, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700', marginTop: 26, marginBottom: 10 },
  holdPrimary: { borderRadius: 22, overflow: 'hidden', marginBottom: 10, ...lift('rgba(225,29,72,0.7)') },
  holdSecondary: { borderRadius: 20, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: 'rgba(147,197,253,0.2)' },
  holdFillPrimary: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, minHeight: 96 },
  holdFill: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, minHeight: 78 },
  holdSweep: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  holdTitlePrimary: { color: '#fff', fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  holdTitle: { color: '#fff', fontSize: 16.5, fontWeight: '800' },
  holdSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12.5, marginTop: 3 },
  holdCount: { color: '#fff', fontSize: 22, fontWeight: '900' },

  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, padding: 14, borderRadius: 20, backgroundColor: 'rgba(11,16,32,0.82)', borderWidth: 1, borderColor: c.line, minHeight: 124 },
  tileSafe: { borderColor: 'rgba(52,211,153,0.45)' },
  tileIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  tileTitle: { color: c.ink, fontSize: 15.5, fontWeight: '800' },
  tileSub: { color: c.muted, fontSize: 12, marginTop: 3, lineHeight: 16 },
  error: { color: c.redl, fontSize: 13, marginTop: 10 },

  contact: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 14, borderRadius: 18, backgroundColor: 'rgba(11,16,32,0.82)', borderWidth: 1, borderColor: c.line },
  contactIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(56,189,248,0.12)' },
  contactText: { color: c.muted, fontSize: 13, lineHeight: 19, flex: 1 },
  ink: { color: c.ink, fontWeight: '700' },

  link: { flexDirection: 'row', alignItems: 'center', marginTop: 18, paddingHorizontal: 6 },
  linkStep: { alignItems: 'center', gap: 6, width: 86 },
  linkIcon: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,16,32,0.8)' },
  linkLabel: { fontSize: 11, fontWeight: '700' },
  linkBar: { flex: 1, height: 1, backgroundColor: c.line2, marginTop: -18 },
  linkNote: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 10, paddingHorizontal: 4 },
  linkNoteText: { color: c.dim, fontSize: 11.5, lineHeight: 16, flex: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
});
