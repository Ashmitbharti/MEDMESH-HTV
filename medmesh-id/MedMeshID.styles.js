import { Platform, StyleSheet } from 'react-native';
import { c, mono } from './theme';

const shadow = (color, radius, opacity, y = 10) => Platform.select({
  web: { boxShadow: `0 ${y}px ${radius * 2}px -${radius / 2}px ${color}` },
  default: { shadowColor: color, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height: y }, elevation: 8 },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  topGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 320 },
  content: { padding: 20, paddingBottom: 56 },

  // hero
  hero: { marginTop: 8, marginBottom: 4 },
  logoWrap: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  logoRing: { position: 'absolute', width: 48, height: 48, borderRadius: 16, borderWidth: 2, borderColor: c.sky4 },
  logo: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', ...shadow('rgba(37,99,235,0.6)', 14, 0.6) },
  eyebrow: { color: c.sky, fontFamily: mono, fontSize: 11, letterSpacing: 2.4, fontWeight: '700', marginBottom: 8 },
  title: { color: c.ink, fontSize: 32, lineHeight: 37, fontWeight: '800', letterSpacing: -0.6, marginBottom: 12 },
  description: { color: c.muted, fontSize: 14.5, lineHeight: 22 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999,
    backgroundColor: 'rgba(125,211,252,0.07)', borderWidth: 1, borderColor: 'rgba(125,211,252,0.2)',
  },
  pillText: { color: '#cfe9fb', fontSize: 12, fontWeight: '600' },

  // cards
  form: {
    marginTop: 18, padding: 18, backgroundColor: c.panel, borderRadius: 24, borderWidth: 1, borderColor: c.line,
    ...shadow('rgba(0,0,0,0.6)', 18, 0.5, 14),
  },
  uploadCard: { marginTop: 22, padding: 14, backgroundColor: c.panel, borderRadius: 22, borderWidth: 1, borderColor: c.line },
  uploadButton: {
    flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 16,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(125,211,252,0.35)', backgroundColor: 'rgba(56,189,248,0.06)',
  },
  uploadIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(56,189,248,0.14)' },
  uploadTitle: { color: c.ink, fontSize: 15, fontWeight: '700' },
  uploadSub: { color: c.muted, fontSize: 12.5, marginTop: 2 },
  uploadDetails: { marginTop: 16 },
  suggestion: { marginTop: 14 },

  // steps
  stepHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { color: c.sky, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700' },
  progress: { color: c.dim, fontFamily: mono, fontSize: 12, fontWeight: '600' },
  track: { height: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', marginTop: 10, marginBottom: 22, overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 999, overflow: 'hidden' },
  label: { color: c.ink, fontSize: 21, fontWeight: '700', letterSpacing: -0.3, marginBottom: 12 },
  help: { color: c.muted, fontSize: 13.5, lineHeight: 20, marginTop: -6, marginBottom: 14 },
  input: {
    minHeight: 54, paddingHorizontal: 16, paddingVertical: 14, color: c.ink, fontSize: 17,
    backgroundColor: c.panel2, borderColor: c.line2, borderWidth: 1, borderRadius: 16,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  customGender: { marginTop: 12 },
  hint: { color: c.dim, fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  errorRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 14, padding: 10, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.08)' },
  error: { color: c.redl, fontSize: 13.5, flex: 1 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 14, borderWidth: 1, borderColor: c.line2, backgroundColor: c.panel2,
  },
  selectedOption: { borderColor: c.sky4, backgroundColor: 'rgba(56,189,248,0.14)', ...shadow('rgba(56,189,248,0.5)', 8, 0.5, 0) },
  optionText: { color: '#d1d5db', fontSize: 15, fontWeight: '600' },
  optionTextOn: { color: '#e0f2fe' },
  navRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  gradBtnWrap: { borderRadius: 16, overflow: 'hidden', ...shadow('rgba(37,99,235,0.55)', 12, 0.55, 8) },
  gradBtn: { minHeight: 54, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  gradBtnText: { color: '#fff', fontSize: 16.5, fontWeight: '800', letterSpacing: 0.2 },
  nextButton: { marginTop: 16, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: c.blue6 },
  nextText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  backButton: {
    width: 54, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 16,
    borderWidth: 1, borderColor: c.line2, backgroundColor: c.panel2,
  },
  backText: { color: '#cfe9fb', fontSize: 15, fontWeight: '700' },
  textButton: { alignItems: 'center', paddingVertical: 14 },
  textButtonText: { color: c.muted, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },

  // review
  reviewTitle: { color: c.ink, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  reviewGroup: { marginTop: 18, gap: 8 },
  reviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16,
    backgroundColor: c.panel2, borderWidth: 1, borderColor: c.line,
  },
  reviewLabel: { color: c.dim, fontSize: 12, fontWeight: '600', marginBottom: 3 },
  reviewValue: { color: c.ink, fontSize: 15.5, lineHeight: 21 },
  noteRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 20, marginBottom: 16, padding: 14, borderRadius: 16, backgroundColor: 'rgba(56,189,248,0.06)' },
  noteText: { color: '#cfe9fb', fontSize: 13.5, lineHeight: 20, flex: 1 },

  // ID card
  flipWrap: { height: 224, marginTop: 22 },
  idCard: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backfaceVisibility: 'hidden', borderRadius: 24, ...shadow('rgba(37,99,235,0.55)', 22, 0.55, 18) },
  idBack: {},
  idCardFill: { flex: 1, borderRadius: 24, padding: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(125,211,252,0.3)' },
  idBackFill: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  idGlowA: { position: 'absolute', top: -80, left: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(125,211,252,0.10)' },
  idGlowB: { position: 'absolute', bottom: -90, right: -50, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(52,211,153,0.07)' },
  idTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { width: 40, height: 29, borderRadius: 7, opacity: 0.9 },
  idBrand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  idBrandText: { color: 'rgba(224,242,254,0.75)', fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' },
  medmeshId: {
    color: '#e0f2fe', fontFamily: mono, fontSize: 31, letterSpacing: 7, fontWeight: '700', marginTop: 20,
    textShadowColor: 'rgba(125,211,252,0.6)', textShadowRadius: 16, textShadowOffset: { width: 0, height: 0 },
  },
  cardName: { color: c.ink, fontSize: 16, fontWeight: '600', marginTop: 4 },
  idMeta: { flexDirection: 'row', gap: 22, marginTop: 14 },
  idMetaLabel: { color: 'rgba(224,242,254,0.55)', fontFamily: mono, fontSize: 9.5, letterSpacing: 1.6, fontWeight: '700', marginBottom: 2 },
  idMetaValue: { color: c.ink, fontSize: 14, fontWeight: '700' },
  idBlood: { color: c.redl, fontSize: 17, fontWeight: '800' },
  idHint: { flexDirection: 'row', alignItems: 'center', gap: 6, position: 'absolute', right: 18, bottom: 14 },
  idHintStatic: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  idHintText: { color: 'rgba(224,242,254,0.7)', fontSize: 11.5 },
  sheen: { position: 'absolute', top: -60, bottom: -60, width: 90 },
  qrContainer: { padding: 8, borderRadius: 16, backgroundColor: '#fff' },
  qrCaption: { color: c.ink, fontSize: 15, fontWeight: '700', marginTop: 4 },
  qrOffline: { color: c.green, fontSize: 12 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
});

export default styles;
