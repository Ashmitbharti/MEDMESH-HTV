import { StyleSheet } from 'react-native';

export default StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#070b14',
  },
  content: {
    padding: 24,
    paddingTop: 36,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 40,
  },
  brandText: {
    color: '#f5f6fa',
    fontSize: 26,
    fontWeight: '700',
  },
  eyebrow: {
    color: '#7dcfff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 12,
  },
  title: {
    color: '#f5f6fa',
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 12,
  },
  description: {
    color: '#969ba6',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 30,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 20,
    marginBottom: 16,
    backgroundColor: '#10141e',
    borderWidth: 1,
    borderColor: '#303541',
    borderRadius: 20,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: '#192332',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    color: '#f5f6fa',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardDescription: {
    color: '#aeb3bd',
    fontSize: 14,
    lineHeight: 21,
  },
  pressed: {
    opacity: 0.7,
  },
});
