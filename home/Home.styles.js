import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#070b14',
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  title: {
    color: '#f5f6fa',
    fontSize: 30,
    fontWeight: '700',
  },
  description: {
    color: '#969ba6',
    fontSize: 16,
    marginTop: 10,
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#10141e',
    borderWidth: 1,
    borderColor: '#303541',
    borderRadius: 20,
    padding: 22,
    marginBottom: 16,
  },
  troubleCard: {
    backgroundColor: '#1b1019',
    borderColor: '#59303b',
  },
  troubleSelected: {
    borderColor: '#ff8c9d',
  },
  helpSelected: {
    borderColor: '#7dcfff',
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  troubleIcon: {
    backgroundColor: '#381923',
  },
  helpIcon: {
    backgroundColor: '#142b41',
  },
  cardTitle: {
    color: '#f5f6fa',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  cardDescription: {
    color: '#aeb3bd',
    fontSize: 14,
    lineHeight: 21,
  },
  notice: {
    color: '#969ba6',
    fontSize: 14,
    lineHeight: 22,
  },
  resumeButton: {
    backgroundColor: '#142b41',
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  resumeText: {
    color: '#7dcfff',
    fontSize: 16,
    fontWeight: '600',
  },
  holdLabel: {
    color: '#f5f6fa',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 20,
  },
  progressTrack: {
    height: 5,
    backgroundColor: '#303541',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#7dcfff',
  },
  troubleProgress: {
    backgroundColor: '#ff8c9d',
  },
  pressed: {
    opacity: 0.7,
  },
});

export default styles;
