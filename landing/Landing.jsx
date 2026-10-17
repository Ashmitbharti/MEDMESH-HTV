import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import styles from './Landing.styles';

const roles = [
  { title: 'Member', description: 'Your Medical ID and emergency help.', icon: 'person-outline', path: '/home', color: '#7dcfff' },
  { title: 'Hospital', description: 'Coordinate care and share hospital availability.', icon: 'medical-outline', path: '/hospital', color: '#ff8c9d' },
  { title: 'Pharmacy', description: 'Share medicine availability and manage supply requests.', icon: 'medkit-outline', path: '/pharmacy', color: '#87dfb1' },
  { title: 'Command Center', description: 'Coordinate emergency requests, hospitals, and responders.', icon: 'radio-outline', path: '/command-center', color: '#c5a3ff' },
];

export default function Landing() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brand}>
          <Ionicons name="pulse" size={30} color="#7dcfff" />
          <Text style={styles.brandText}>MedMesh</Text>
        </View>
        <Text style={styles.eyebrow}>CONNECTED FOR CARE</Text>
        <Text style={styles.title}>How would you like to enter?</Text>
        <Text style={styles.description}>Choose your role to get started.</Text>
        {roles.map((role) => (
          <Pressable key={role.title} accessibilityRole="button" accessibilityLabel={`Enter as ${role.title}`}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            onPress={() => router.push(role.path)}>
            <View style={styles.icon}>
              <Ionicons name={role.icon} size={27} color={role.color} />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>Enter as {role.title}</Text>
              <Text style={styles.cardDescription}>{role.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={role.color} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
