import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#070b14',
  },
  bar: {
    backgroundColor: '#0d111c',
    borderColor: '#303541',
    borderWidth: 1,
    borderTopWidth: 1,
    borderRadius: 26,
    height: 72,
    marginHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    elevation: 0,
  },
  item: {
    minHeight: 48,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});

export default styles;
