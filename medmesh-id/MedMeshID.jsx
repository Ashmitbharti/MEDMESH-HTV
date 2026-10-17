import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import {
  Accessibility, Check, ChevronLeft, ChevronRight, CircleAlert, HeartPulse, Lock, Pencil, Radio, WifiOff,
} from 'lucide-react-native';
import styles from './MedMeshID.styles';
import { c, grad } from './theme';
import PdfAutofill from './PdfAutofill';
import MedMeshIDCard from './MedMeshIDCard';
import { loadProfile, saveProfile } from './profileService';

// `multi` fields store a comma-separated string so the existing validation and Supabase mapping keep working.
const fields = [
  { key: 'name', section: 'About you', label: 'Full name', placeholder: 'Your name' },
  { key: 'age', section: 'About you', label: 'Age', placeholder: 'Your age', keyboardType: 'number-pad' },
  { key: 'gender', section: 'About you', label: 'Gender', options: ['Female', 'Male', 'Non-binary', 'Enter my own gender'] },
  { key: 'blood', section: 'About you', label: 'Blood group', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  { key: 'allergies', section: 'Medical', label: 'Allergies', placeholder: 'e.g. Penicillin, peanuts', multiline: true },
  { key: 'conditions', section: 'Medical', label: 'Conditions', placeholder: 'e.g. Type 2 diabetes, asthma', multiline: true },
  { key: 'medications', section: 'Medical', label: 'Medications', placeholder: 'e.g. Metformin, salbutamol inhaler', multiline: true },
  {
    key: 'devices', section: 'In an outage', label: 'Do you rely on any of these?', multi: true,
    options: ['Home oxygen', 'CPAP / BiPAP', 'Insulin', 'Dialysis', 'Wheelchair or walker', 'None'],
    help: 'Helps responders reach you first if the power goes out.',
  },
  { key: 'mobility', section: 'In an outage', label: 'How do you get around?', options: ['On my own', 'Need some help', 'Wheelchair or bed-bound'] },
  { key: 'lives_alone', section: 'In an outage', label: 'Do you live alone?', options: ['Yes', 'No'] },
  {
    key: 'home_hospital', section: 'In an outage', label: 'Your usual hospital',
    options: ['Scarborough General', 'Centenary Hospital', 'Birchmount Hospital', 'Other / not sure'],
    help: 'Your records and specialists are there. The command centre gives it a small preference.',
  },
  { key: 'contact', section: 'Contact', label: 'Emergency contact', placeholder: 'Name and phone number', multiline: true },
];

const splitMulti = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

function Pill({ icon: Icon, text }) {
  return (
    <View style={styles.pill}>
      <Icon size={13} color={c.sky} strokeWidth={2.2} />
      <Text style={styles.pillText}>{text}</Text>
    </View>
  );
}

function GradientButton({ label, onPress, disabled, icon: Icon, accessibilityState }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.gradBtnWrap, pressed && styles.pressed, disabled && { opacity: 0.6 }]}
    >
      <LinearGradient colors={grad.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradBtn}>
        <Text style={styles.gradBtnText}>{label}</Text>
        {Icon ? <Icon size={18} color="#fff" strokeWidth={2.4} /> : null}
      </LinearGradient>
    </Pressable>
  );
}

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

  const pulse = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(1)).current;
  const dir = useRef(1);
  const progress = useRef(new Animated.Value(0)).current;

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

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.timing(progress, {
      toValue: Math.min(step, fields.length) / fields.length, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [step, enter, progress]);

  function displayValue(item) {
    if (item.key === 'gender' && details.gender === 'Enter my own gender') return details.customGender;
    return details[item.key];
  }

  function validateAnswer(item) {
    const value = displayValue(item);
    if (!value || !value.trim()) {
      return item.options ? 'Please choose an option.' : `Please enter your ${item.label.toLowerCase()}.`;
    }
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
    if (nextStep > step && field) {
      const message = validateAnswer(field);
      if (message) {
        setError(message);
        return;
      }
    }
    dir.current = nextStep > step ? 1 : -1;
    setError('');
    Keyboard.dismiss();
    setStep(nextStep);
  }

  function updateDetail(value) {
    setError('');
    setDirty(true);
    setDetails((current) => ({ ...current, [field.key]: value }));
  }

  function toggleMulti(option) {
    const current = splitMulti(details[field.key]);
    let next;
    if (option === 'None') next = current.includes('None') ? [] : ['None'];
    else {
      const without = current.filter((x) => x !== 'None');
      next = without.includes(option) ? without.filter((x) => x !== option) : [...without, option];
    }
    updateDetail(next.join(', '));
  }

  const slide = {
    opacity: enter,
    transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [24 * dir.current, 0] }) }],
  };
  const heartScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const sections = [...new Set(fields.map((f) => f.section))];

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <LinearGradient colors={grad.glow} style={styles.topGlow} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        pointerEvents={saving || loading ? 'none' : 'auto'}
      >
        <View style={styles.hero}>
          <View style={styles.logoWrap}>
            <Animated.View style={[styles.logoRing, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <LinearGradient colors={grad.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logo}>
                <HeartPulse size={22} color="#fff" strokeWidth={2.4} />
              </LinearGradient>
            </Animated.View>
          </View>
          <Text style={styles.eyebrow}>MEDMESH ID</Text>
          <Text style={styles.title}>Your emergency{'\n'}medical ID</Text>
          <Text style={styles.description}>
            Fill this in before an emergency. When the network is down, only your 6-letter ID travels over the mesh,
            and the command centre already knows how to help you.
          </Text>
          <View style={styles.pills}>
            <Pill icon={Lock} text="Opt-in" />
            <Pill icon={Radio} text="Only 6 letters travel" />
            <Pill icon={WifiOff} text="Works offline" />
          </View>
        </View>

        {loading ? <Text style={styles.hint}>Loading your saved profile…</Text> : null}

        {profile ? <MedMeshIDCard profile={profile} dirty={dirty} /> : null}

        {field ? (
          <PdfAutofill
            fields={fields}
            details={details}
            onApply={(answers) => {
              setDetails((current) => ({ ...current, ...answers }));
              setDirty(true);
              setError('');
            }}
          />
        ) : null}

        <View style={styles.form}>
          {field ? (
            <>
              <View style={styles.stepHead}>
                <Text style={styles.section}>{field.section.toUpperCase()}</Text>
                <Text style={styles.progress}>{step + 1} / {fields.length}</Text>
              </View>
              <View style={styles.track}>
                <Animated.View style={[styles.trackFill, {
                  width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                }]}
                >
                  <LinearGradient colors={grad.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
                </Animated.View>
              </View>

              <Animated.View style={slide}>
                <Text style={styles.label}>{field.label}</Text>
                {field.help ? <Text style={styles.help}>{field.help}</Text> : null}

                {field.options ? (
                  <View style={styles.options}>
                    {field.options.map((option) => {
                      const selected = field.multi
                        ? splitMulti(details[field.key]).includes(option)
                        : details[field.key] === option;
                      return (
                        <Pressable
                          key={option}
                          accessibilityRole={field.multi ? 'checkbox' : 'radio'}
                          accessibilityLabel={option}
                          accessibilityState={{ checked: selected }}
                          style={({ pressed }) => [styles.option, selected && styles.selectedOption, pressed && styles.pressed]}
                          onPress={() => (field.multi ? toggleMulti(option) : updateDetail(option))}
                        >
                          {selected ? <Check size={14} color={c.sky} strokeWidth={3} /> : null}
                          <Text style={[styles.optionText, selected && styles.optionTextOn]}>{option}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <TextInput
                    key={field.key}
                    style={[styles.input, field.multiline && styles.multiline]}
                    accessibilityLabel={field.label}
                    placeholder={field.placeholder}
                    placeholderTextColor={c.dim}
                    autoCapitalize={field.key === 'age' ? 'none' : 'sentences'}
                    keyboardType={field.keyboardType || 'default'}
                    multiline={field.multiline || false}
                    value={details[field.key] || ''}
                    onChangeText={updateDetail}
                    onSubmitEditing={field.multiline ? undefined : () => changeStep(step + 1)}
                  />
                )}

                {field.key === 'gender' && details.gender === 'Enter my own gender' ? (
                  <TextInput
                    style={[styles.input, styles.customGender]}
                    accessibilityLabel="Your gender"
                    placeholder="Enter your gender"
                    placeholderTextColor={c.dim}
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
              </Animated.View>

              {error ? (
                <View style={styles.errorRow}>
                  <CircleAlert size={15} color={c.redl} />
                  <Text style={styles.error} accessibilityRole="alert">{error}</Text>
                </View>
              ) : null}

              <View style={styles.navRow}>
                {step > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                    onPress={() => changeStep(step - 1)}
                  >
                    <ChevronLeft size={20} color={c.ink} />
                  </Pressable>
                ) : null}
                <View style={{ flex: 1 }}>
                  <GradientButton
                    label={step === fields.length - 1 ? 'Review details' : 'Next'}
                    icon={ChevronRight}
                    onPress={() => changeStep(step + 1)}
                  />
                </View>
              </View>
            </>
          ) : (
            <Animated.View style={slide}>
              <Text style={styles.reviewTitle}>Review your details</Text>
              <Text style={styles.description}>Tap any answer to change it.</Text>
              {sections.map((sec) => (
                <View key={sec} style={styles.reviewGroup}>
                  <Text style={styles.section}>{sec.toUpperCase()}</Text>
                  {fields.map((item, index) => (item.section !== sec ? null : (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${item.label}`}
                      style={({ pressed }) => [styles.reviewRow, pressed && styles.pressed]}
                      onPress={() => { dir.current = -1; setStep(index); }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reviewLabel}>{item.label}</Text>
                        <Text style={styles.reviewValue}>{displayValue(item) || '—'}</Text>
                      </View>
                      <Pencil size={15} color={c.dim} />
                    </Pressable>
                  )))}
                </View>
              ))}
              <View style={styles.noteRow}>
                <Accessibility size={16} color={c.sky} />
                <Text style={styles.noteText}>
                  {profile ? 'Save any changes before closing the app.'
                    : 'Saved on this phone first. When you are online, your ID is registered and shared with the MedMesh command centre so it works offline in an emergency.'}
                </Text>
              </View>
              {error ? (
                <View style={styles.errorRow}>
                  <CircleAlert size={15} color={c.redl} />
                  <Text style={styles.error} accessibilityRole="alert">{error}</Text>
                </View>
              ) : null}
              <GradientButton
                label={saving ? 'Saving…' : profile?.status === 'pending' && !dirty
                  ? 'Retry sync' : profile?.medmeshId ? 'Save changes' : 'Save & create my ID'}
                icon={saving ? null : Check}
                disabled={saving || loading}
                accessibilityState={{ disabled: saving || loading, busy: saving }}
                onPress={handleSave}
              />
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
                onPress={() => changeStep(fields.length - 1)}
              >
                <Text style={styles.textButtonText}>Back to the form</Text>
              </Pressable>
            </Animated.View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
