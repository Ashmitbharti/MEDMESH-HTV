import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import styles from '../navigation/Navbar.styles';

export default function CommandNavbar() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs initialRouteName="sos" backBehavior="history" screenOptions={{
      headerShown: false,
      sceneStyle: styles.screen,
      tabBarActiveTintColor: '#c5a3ff',
      tabBarInactiveTintColor: '#747b89',
      tabBarStyle: [styles.bar, { marginBottom: Math.max(insets.bottom, 12) }],
      tabBarLabelStyle: styles.label,
      tabBarItemStyle: styles.item,
      tabBarHideOnKeyboard: true,
    }}>
      <Tabs.Screen name="sos" options={{
        title: 'SOS',
        tabBarIcon: ({ color, size }) => <Ionicons name="alert-circle-outline" size={size} color={color} />,
      }} />
      <Tabs.Screen name="index" options={{
        title: 'Hospitals',
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? 'medical' : 'medical-outline'} size={size} color={color} />
        ),
      }} />
      <Tabs.Screen name="pharmacies" options={{
        title: 'Pharmacies',
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? 'medkit' : 'medkit-outline'} size={size} color={color} />
        ),
      }} />
      <Tabs.Screen name="supplies" options={{
        title: 'Supplies',
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? 'cube' : 'cube-outline'} size={size} color={color} />
        ),
      }} />
    </Tabs>
  );
}
