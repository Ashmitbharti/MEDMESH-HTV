import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { House, IdCard } from 'lucide-react-native';
import styles from './Navbar.styles';
import { c } from '../medmesh-id/theme';

export default function Navbar() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Tabs
        initialRouteName="index"
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          sceneStyle: styles.screen,
          tabBarActiveTintColor: c.sky,
          tabBarInactiveTintColor: '#6b7280',
          tabBarStyle: [styles.bar, { marginBottom: Math.max(insets.bottom, 12) }],
          tabBarLabelStyle: styles.label,
          tabBarItemStyle: styles.item,
          tabBarHideOnKeyboard: true,
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <House size={22} color={color} strokeWidth={2.2} /> }} />
        <Tabs.Screen name="profile" options={{ title: 'My ID', tabBarIcon: ({ color }) => <IdCard size={22} color={color} strokeWidth={2.2} /> }} />
        <Tabs.Screen name="sos" options={{ href: null }} />
        <Tabs.Screen name="safe" options={{ href: null }} />
        <Tabs.Screen name="medicine" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
