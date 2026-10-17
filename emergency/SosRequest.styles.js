import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#070b14' },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: '#f5f6fa', fontSize: 28, fontWeight: '700', marginBottom: 18 },
  statusCard: {
    backgroundColor: '#1b1019', borderColor: '#59303b', borderWidth: 1,
    borderRadius: 20, padding: 18, marginBottom: 18,
  },
  statusTitle: { color: '#ff8c9d', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  description: { color: '#aeb3bd', fontSize: 15, lineHeight: 23 },
  hint: { color: '#969ba6', fontSize: 13, lineHeight: 20, marginTop: 8 },
  card: {
    backgroundColor: '#10141e', borderColor: '#303541', borderWidth: 1,
    borderRadius: 20, padding: 20, marginTop: 20, marginBottom: 20,
  },
  progress: { color: '#7dcfff', fontSize: 13, marginBottom: 16 },
  question: { color: '#f5f6fa', fontSize: 23, fontWeight: '700', lineHeight: 30 },
  input: {
    backgroundColor: '#1a1e28', borderColor: '#303541', borderWidth: 1,
    borderRadius: 14, padding: 14, color: '#f5f6fa', fontSize: 16, marginTop: 18,
  },
  primaryButton: { backgroundColor: '#2196f3', padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 14 },
  answerButton: {
    backgroundColor: '#1a1e28', borderColor: '#303541', borderWidth: 1,
    padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 14,
  },
  buttonText: { color: '#f5f6fa', fontSize: 16, fontWeight: '600' },
  cancelButton: { borderColor: '#59303b', borderWidth: 1, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 14 },
  cancelText: { color: '#ff8c9d', fontSize: 16, fontWeight: '600' },
  summaryRow: { borderBottomColor: '#303541', borderBottomWidth: 1, paddingBottom: 16, marginBottom: 8 },
  summaryValue: { color: '#f5f6fa', fontSize: 16, marginTop: 6 },
  error: { color: '#ff8c9d', fontSize: 14, lineHeight: 21, marginTop: 16 },
  pressed: { opacity: 0.7 },
  cameraFrame: {
    height: 240,
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 20,
    backgroundColor: '#1a1e28',
  },
  camera: {
    flex: 1,
  },
  scannedId: {
    color: '#7dcfff',
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 4,
    marginTop: 20,
  },
});

export default styles;
