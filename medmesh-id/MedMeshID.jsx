import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import styles from './MedMeshID.styles';
import PdfAutofill from './PdfAutofill';
import MedMeshIDCard from './MedMeshIDCard';
import { loadProfile, saveProfile } from './profileService';
import { Keyboard, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';

const fields = [
  { key: 'name', label: 'Full name', placeholder: 'Your name' },
  { key: 'age', label: 'Age', placeholder: 'Your age', keyboardType: 'number-pad' },
  { key: 'gender', label: 'Gender', options: ['Female', 'Male', 'Non-binary', 'Enter my own gender'] },
  { key: 'blood', label: 'Blood group', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  { key: 'allergies', label: 'Allergies', placeholder: 'List any allergies', multiline: true },
  { key: 'conditions', label: 'Conditions', placeholder: 'List any medical conditions', multiline: true },
  { key: 'medications', label: 'Medications', placeholder: 'List your medications', multiline: true },
  { key: 'contact', label: 'Emergency contact', placeholder: 'Name and phone number', multiline: true },
];

export default function MedMeshID() {
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState({});
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const savingRef = useRef(false);
  const field = fields[step];

  useEffect(() => {
    let active = true;
    loadProfile().then((stored) => {
      if (active && stored) {
        setProfile(stored);
        setDetails(stored.details);
        setStep(fields.length);
      }
    }).catch(() => {
      if (active) setError('Could not load the saved profile from this phone.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  function validateAnswer(item) {
    const value = item.key === 'gender' && details.gender === 'Enter my own gender'
      ? details.customGender
      : details[item.key];
    if (!value || !value.trim()) return `Please enter your ${item.label.toLowerCase()}.`;
    if (item.key === 'age' && (!/^\d+$/.test(value.trim()) || Number(value) > 130)) {
      return 'Please enter a whole-number age between 0 and 130.';
    }
    return '';
  }

  async function handleSave() {
    if (savingRef.current) return;
    for (let index = 0; index < fields.length; index++) {
      const message = validateAnswer(fields[index]);
      if (message) {
        setError(message);
        setStep(index);
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await saveProfile(details, profile);
      setProfile(result.profile);
      setError(result.syncError);
      setDirty(false);
    } catch {
      setError('Could not save on this phone. Please try again before closing the app.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function changeStep(nextStep) {
    if (nextStep > step) {
      const message = validateAnswer(field);
      if (message) {
        setError(message);
        return;
      }
    }

    setError('');
    Keyboard.dismiss();
    setStep(nextStep);
  }

  function updateDetail(value) {
    setError('');
    setDirty(true);
    setDetails((current) => ({ ...current, [field.key]: value }));
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        pointerEvents={saving || loading ? 'none' : 'auto'}
      >
        <Text style={styles.title}>Medical ID</Text>

        <Text style={styles.description}>
          Opt-in. Fill this in before an emergency. Only your 6-letter ID
          travels over the mesh.
        </Text>

        {loading ? <Text style={styles.hint}>Loading your saved profile…</Text> : null}

        {profile ? (
          <MedMeshIDCard profile={profile} dirty={dirty} />
        ) : null}

        <PdfAutofill
          fields={fields}
          details={details}
          onApply={(answers) => {
            setDetails((current) => ({ ...current, ...answers }));
            setDirty(true);
            setError('');
          }}
        />

        <View style={styles.form}>
          {field ? (
            <>
              <Text style={styles.progress}>Step {step + 1} of {fields.length}</Text>
              <Text style={styles.label}>{field.label} *</Text>

              {field.options ? (
                <View style={styles.options}>
                  {field.options.map((option) => (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityLabel={option}
                      accessibilityState={{ checked: details[field.key] === option }}
                      style={({ pressed }) => [
                        styles.option,
                        details[field.key] === option && styles.selectedOption,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => updateDetail(option)}
                    >
                      <Text style={styles.optionText}>{option}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <TextInput
                  key={field.key}
                  style={[styles.input, field.multiline && styles.multiline]}
                  accessibilityLabel={field.label}
                  placeholder={field.placeholder}
                  placeholderTextColor="#777d89"
                  autoCapitalize={field.key === 'age' ? 'none' : 'sentences'}
                  keyboardType={field.keyboardType || 'default'}
                  multiline={field.multiline || false}
                  value={details[field.key] || ''}
                  onChangeText={updateDetail}
                />
              )}

              {field.key === 'gender' && details.gender === 'Enter my own gender' ? (
                <TextInput
                  style={[styles.input, styles.customGender]}
                  accessibilityLabel="Your gender"
                  placeholder="Enter your gender"
                  placeholderTextColor="#777d89"
                  value={details.customGender || ''}
                  onChangeText={(value) => {
                    setError('');
                    setDirty(true);
                    setDetails((current) => ({ ...current, customGender: value }));
                  }}
                />
              ) : null}

              {['allergies', 'conditions', 'medications'].includes(field.key) ? (
                <Text style={styles.hint}>Enter None if this does not apply.</Text>
              ) : null}

              {error ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}
                onPress={() => changeStep(step + 1)}
              >
                <Text style={styles.nextText}>
                  {step === fields.length - 1 ? 'Review details' : 'Next'}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.reviewTitle}>Review your details</Text>
              {fields.map((item) => (
                <View key={item.key} style={styles.reviewRow}>
                  <Text style={styles.label}>{item.label}</Text>
                  <Text style={styles.reviewValue}>
                    {item.key === 'gender' && details.gender === 'Enter my own gender'
                      ? details.customGender
                      : details[item.key]}
                  </Text>
                </View>
              ))}
              <Text style={styles.description}>
                {profile ? 'Save any changes before closing the app.'
                  : 'Save a copy on this phone and register your ID with Supabase when online.'}
              </Text>
              {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving || loading, busy: saving }}
                disabled={saving || loading}
                style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}
                onPress={handleSave}
              >
                <Text style={styles.nextText}>
                  {saving ? 'Saving…' : profile?.status === 'pending' && !dirty
                    ? 'Retry sync' : profile?.medmeshId ? 'Save changes' : 'Save & create my ID'}
                </Text>
              </Pressable>
            </>
          )}

          {step > 0 ? (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
              onPress={() => changeStep(step - 1)}
            >
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

