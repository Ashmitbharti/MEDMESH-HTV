import { StyleSheet } from 'react-native';
import shared from '../hospital/Hospital.styles';

export default StyleSheet.create({
  ...shared,
  request: {
    backgroundColor: '#0a0e17',
    borderWidth: 1,
    borderColor: '#303541',
    borderRadius: 14,
    padding: 14,
    marginVertical: 8,
  },
  action: {
    backgroundColor: '#142b41',
    borderWidth: 1,
    borderColor: '#294159',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  selected: {
    borderColor: '#7dcfff',
    backgroundColor: '#142b41',
  },
});
