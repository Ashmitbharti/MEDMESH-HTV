import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#070b14',
  },
  content: {
    padding: 20,
    paddingBottom: 32,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
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
  historyRow: {
    borderTopWidth: 1,
    borderTopColor: '#303541',
    paddingTop: 14,
    marginTop: 14,
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
  sosHero: {
    alignItems: 'center',
    paddingVertical: 26,
    paddingHorizontal: 12,
    backgroundColor: '#130d18',
    borderColor: '#392031',
    borderWidth: 1,
    borderRadius: 28,
    marginBottom: 18,
  },
  sosHalo: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#281121',
    borderRadius: 112,
    boxShadow: '0 0 30px rgba(225, 29, 72, 0.22)',
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  sosCore: {
    width: 192,
    height: 192,
    borderRadius: 96,
    backgroundColor: '#d81c4c',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ff698b',
  },
  sosWord: {
    color: '#fff',
    fontSize: 48,
    letterSpacing: 3,
    fontWeight: '800',
  },
  sosCaption: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  heroText: {
    alignItems: 'center',
    marginTop: 22,
  },
  heroTitle: {
    color: '#f5f6fa',
    fontSize: 23,
    fontWeight: '700',
    marginBottom: 8,
  },
  helperCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 18,
    backgroundColor: '#101b28',
    borderColor: '#294159',
    borderWidth: 1,
    borderRadius: 24,
    marginBottom: 18,
  },
  helperCircle: {
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helperCore: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#142f47',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helperText: {
    flex: 1,
  },
  helperTitle: {
    color: '#f5f6fa',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  disabled: {
    opacity: 0.45,
  },
  sosPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  firstAidCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#101e1b',
    borderWidth: 1,
    borderColor: '#284b40',
    marginBottom: 14,
  },
  firstAidIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#19392e',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default styles;
