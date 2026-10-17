import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#05070f' },
  content: { padding: 20, paddingBottom: 120 },
  title: { color: '#eef1f7', fontSize: 30, fontWeight: '800', letterSpacing: -0.6, marginBottom: 18 },
  pendingCard: { backgroundColor: 'rgba(251,191,36,0.07)', borderColor: 'rgba(251,191,36,0.4)', borderWidth: 1, borderRadius: 20, padding: 18, marginBottom: 18 },
  pendingTitle: { color: '#fde68a', fontSize: 17, fontWeight: '800', marginBottom: 8 },
  statusCard: {
    backgroundColor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.4)', borderWidth: 1,
    borderRadius: 20, padding: 18, marginBottom: 18,
  },
  statusTitle: { color: '#fca5a5', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  description: { color: '#9ca3af', fontSize: 15, lineHeight: 23 },
  hint: { color: '#6b7280', fontSize: 13, lineHeight: 20, marginTop: 8 },
  card: {
    backgroundColor: '#0b1020', borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
    borderRadius: 24, padding: 20, marginTop: 20, marginBottom: 20,
  },
  progress: { color: '#7dd3fc', fontSize: 13, marginBottom: 16 },
  question: { color: '#eef1f7', fontSize: 24, fontWeight: '800', lineHeight: 31, letterSpacing: -0.3 },
  input: {
    backgroundColor: '#0f1629', borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
    borderRadius: 14, padding: 14, color: '#eef1f7', fontSize: 16, marginTop: 18,
  },
  primaryButton: { backgroundColor: '#2563eb', padding: 17, borderRadius: 16, alignItems: 'center', marginTop: 14 },
  answerButton: {
    backgroundColor: '#0f1629', borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
    padding: 17, borderRadius: 16, alignItems: 'center', marginTop: 12,
  },
  buttonText: { color: '#eef1f7', fontSize: 16.5, fontWeight: '700' },
  cancelButton: { borderColor: 'rgba(239,68,68,0.4)', borderWidth: 1, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 14 },
  cancelText: { color: '#fca5a5', fontSize: 16, fontWeight: '600' },
  summaryRow: { borderBottomColor: 'rgba(255,255,255,0.12)', borderBottomWidth: 1, paddingBottom: 16, marginBottom: 8 },
  summaryValue: { color: '#eef1f7', fontSize: 16, marginTop: 6 },
  error: { color: '#fca5a5', fontSize: 14, lineHeight: 21, marginTop: 16 },
  pressed: { opacity: 0.7 },
  cameraFrame: {
    height: 240,
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 20,
    backgroundColor: '#0f1629',
  },
  camera: {
    flex: 1,
  },
  scannedId: {
    color: '#7dd3fc',
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 4,
    marginTop: 20,
  },
});

export default styles;
