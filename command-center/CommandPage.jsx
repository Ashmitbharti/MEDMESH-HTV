import { Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import styles from '../landing/Landing.styles';

export default function CommandPage({ title }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>COMMAND CENTER</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{title} will appear here once connected.</Text>
        <Pressable accessibilityRole="button" style={styles.card} onPress={() => router.replace('/')}>
          <Text style={styles.cardTitle}>Switch role</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
