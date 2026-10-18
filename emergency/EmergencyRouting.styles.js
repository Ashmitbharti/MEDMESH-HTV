import { StyleSheet } from 'react-native';
import hospitalStyles from '../hospital/Hospital.styles';

export default StyleSheet.create({
  ...hospitalStyles,
  option: { borderWidth: 1, borderColor: '#303541', borderRadius: 12, padding: 14, marginTop: 10 },
  selected: { borderColor: '#7dcfff', backgroundColor: '#132838' },
  disabled: { opacity: 0.45 },
  status: { color: '#ff8c9d', fontSize: 15, fontWeight: '700', marginVertical: 10 },
});
