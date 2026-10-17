import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import CommandNavbar from './CommandNavbar';
import styles from '../hospital/Hospital.styles';

// Demo access gate only. A bundled key does not authorize database or staff access.
const commandKey = '837416';

export default function CommandAccess() {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [unlocked, setUnlocked] = useState(false);

  function unlock() {
    if (key !== commandKey) {
      setError(key.length !== 6 ? 'Enter the six-digit Command Center key.' : 'Incorrect access key. Try again.');
      setKey('');
      return;
    }
    setKey('');
    setError('');
    setUnlocked(true);
  }

  if (unlocked) return <CommandNavbar />;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>MEDMESH · COMMAND CENTER</Text>
        <Text style={styles.title}>Enter your access key</Text>
        <Text style={styles.description}>Enter the six-digit key to open the Command Center.</Text>
        <Text style={styles.label}>Command Center key</Text>
        <TextInput accessibilityLabel="Six-digit Command Center access key" style={styles.input}
          keyboardType="number-pad" maxLength={6} secureTextEntry autoCorrect={false}
          value={key} placeholder="••••••" placeholderTextColor="#777d89"
          onChangeText={(value) => { setKey(value.replace(/\D/g, '')); setError(''); }}
          onSubmitEditing={unlock} />
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Pressable accessibilityRole="button" style={styles.primary} onPress={unlock}>
          <Text style={styles.primaryText}>Open Command Center</Text>
        </Pressable>
        <Text style={styles.hint}>Demo access · this key does not grant database editing permissions.</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.link}>Switch role</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
