import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#070b14',
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  title: {
    color: '#f5f6fa',
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 10,
  },
  description: {
    color: '#969ba6',
    fontSize: 14,
    lineHeight: 21,
  },
  form: {
    marginTop: 28,
    padding: 16,
    backgroundColor: '#10141e',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#232734',
  },
  uploadCard: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#10141e',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#232734',
  },
  uploadButton: {
    padding: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#36526b',
    backgroundColor: '#122332',
    borderRadius: 14,
  },
  uploadDetails: {
    marginTop: 18,
  },
  suggestion: {
    marginTop: 16,
  },
  label: {
    color: '#aeb3bd',
    fontSize: 13,
    marginBottom: 8,
  },
  progress: {
    color: '#7dcfff',
    fontSize: 12,
    marginBottom: 20,
  },
  customGender: {
    marginTop: 16,
  },
  hint: {
    color: '#969ba6',
    fontSize: 13,
    marginTop: 10,
  },
  error: {
    color: '#ff8c9d',
    fontSize: 14,
    marginTop: 12,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  option: {
    minWidth: 64,
    minHeight: 48,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1e28',
    borderWidth: 1,
    borderColor: '#303541',
    borderRadius: 14,
  },
  selectedOption: {
    backgroundColor: '#16334b',
    borderColor: '#7dcfff',
  },
  optionText: {
    color: '#f5f6fa',
    fontSize: 16,
  },
  multiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  reviewTitle: {
    color: '#f5f6fa',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
  },
  medmeshId: {
    color: '#7dcfff',
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 4,
  },
  reviewRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#232734',
    paddingBottom: 14,
    marginBottom: 14,
  },
  reviewValue: {
    color: '#f5f6fa',
    fontSize: 16,
    lineHeight: 24,
  },
  nextButton: {
    backgroundColor: '#2196f3',
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  nextText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    borderWidth: 1,
    borderColor: '#303541',
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  backText: {
    color: '#7dcfff',
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
  input: {
    backgroundColor: '#1a1e28',
    borderWidth: 1,
    borderColor: '#303541',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: '#f5f6fa',
    fontSize: 16,
  },
});

export default styles;
