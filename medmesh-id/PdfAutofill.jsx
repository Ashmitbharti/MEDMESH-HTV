import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import styles from './MedMeshID.styles';
import { readReport } from './reportService';

export default function PdfAutofill({ fields, details, onApply }) {
  const [file, setFile] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const picking = useRef(false);

  async function choosePdf() {
    if (picking.current) return;
    picking.current = true;
    setError('');
    setMessage('');

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        multiple: false,
        copyToCacheDirectory: true,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset.size || asset.size > 5 * 1024 * 1024) {
        throw new Error('Choose a non-empty PDF smaller than 5 MB.');
      }
      setFile(asset);
      setSuggestions(null);
    } catch (error) {
      setError(error.message || 'Could not select a PDF. Please try again.');
    } finally {
      picking.current = false;
    }
  }

  async function uploadPdf() {
    setLoading(true);
    setError('');

    try {
      const extracted = await readReport(file);
      const answers = {};
      for (const field of fields) {
        if (typeof extracted[field.key] === 'string' && extracted[field.key].trim()) {
          answers[field.key] = extracted[field.key].trim();
        }
      }
      if (!Object.keys(answers).length) {
        throw new Error('No matching details were found. Please fill in the form manually.');
      }
      setSuggestions(answers);
    } catch (error) {
      setError(error.message || 'Could not read the PDF. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function applySuggestions() {
    const answers = {};
    for (const field of fields) {
      const value = suggestions[field.key]?.trim();
      if (!value || details[field.key]?.trim()) continue;
      if (field.key === 'age' && (!/^\d+$/.test(value) || Number(value) > 130)) {
        setError('Review the suggested age: enter a whole number between 0 and 130.');
        return;
      }
      if (field.key === 'blood' && !field.options.includes(value)) {
        setError('Review the suggested blood group: use a value such as A+ or O-.');
        return;
      }
      if (field.key === 'gender' && !['Female', 'Male', 'Non-binary'].includes(value)) {
        answers.gender = 'Enter my own gender';
        answers.customGender = value;
      } else {
        answers[field.key] = value;
      }
    }
    onApply(answers);
    setSuggestions(null);
    setFile(null);
    setError('');
    setMessage(Object.keys(answers).length
      ? 'Details added. Please check each answer before continuing.'
      : 'Your existing answers were kept. No blank fields matched the report.');
  }

  return (
    <View style={styles.uploadCard}>
      <Pressable
        accessibilityRole="button"
        disabled={loading}
        accessibilityState={{ disabled: loading, busy: loading }}
        style={({ pressed }) => [styles.uploadButton, pressed && styles.pressed]}
        onPress={choosePdf}
      >
        <Text style={styles.backText}>{loading ? 'Reading PDF…' : 'Auto-fill from checkup PDF'}</Text>
      </Pressable>
      <Text style={styles.hint}>Optional · text PDF · up to 5 MB and 20 pages</Text>

      {file && !suggestions ? (
        <View style={styles.uploadDetails}>
          <Text style={styles.reviewValue}>{file.name}</Text>
          <Text style={styles.hint}>
            Upload this report to Supabase to find details for your form. You can review them before applying. The report is not stored.
          </Text>
          <Pressable accessibilityRole="button" disabled={loading} style={styles.nextButton} onPress={uploadPdf}>
            <Text style={styles.nextText}>{loading ? 'Reading PDF…' : 'Upload and read PDF'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            style={styles.backButton}
            onPress={() => { setFile(null); setError(''); }}
          >
            <Text style={styles.backText}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {suggestions ? (
        <View style={styles.uploadDetails}>
          <Text style={styles.reviewTitle}>Check extracted details</Text>
          <Text style={styles.hint}>Edit any mistakes. Only empty fields will be filled.</Text>
          {fields.filter((field) => suggestions[field.key] !== undefined).map((field) => (
            <View key={field.key} style={styles.suggestion}>
              <Text style={styles.label}>{field.label}{details[field.key] ? ' (existing answer kept)' : ''}</Text>
              <TextInput
                accessibilityLabel={`Suggested ${field.label.toLowerCase()}`}
                style={styles.input}
                value={suggestions[field.key]}
                onChangeText={(value) => {
                  setError('');
                  setSuggestions((current) => ({ ...current, [field.key]: value }));
                }}
              />
            </View>
          ))}
          <Pressable accessibilityRole="button" style={styles.nextButton} onPress={applySuggestions}>
            <Text style={styles.nextText}>Apply to empty fields</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => {
            setSuggestions(null);
            setFile(null);
            setError('');
          }}>
            <Text style={styles.backText}>Discard</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {message ? <Text style={styles.hint} accessibilityLiveRegion="polite">{message}</Text> : null}
    </View>
  );
}
