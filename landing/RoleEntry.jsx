import { Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import styles from './Landing.styles';

export default function RoleEntry({ role }) {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>MEDMESH</Text>
        <Text style={styles.title}>{role}</Text>
        <Text style={styles.description}>Your {role.toLowerCase()} workspace is coming next.</Text>
        <Pressable accessibilityRole="button" style={styles.card} onPress={() => router.replace('/')}>
          <Text style={styles.cardTitle}>Choose another role</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
