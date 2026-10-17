import { Platform, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#05070f' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(11,16,32,0.92)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderTopWidth: 1,
    borderRadius: 26,
    height: 74,
    marginHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    elevation: 0,
    ...Platform.select({ web: { backdropFilter: 'blur(14px)', boxShadow: '0 12px 30px -10px rgba(0,0,0,0.8)' }, default: {} }),
  },
  item: { minHeight: 48 },
  label: { fontSize: 11.5, fontWeight: '700', marginTop: 3 },
});

export default styles;
