import { Pressable, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import styles from './Home.styles';

export default function SosButton({ mode, holding, remaining, disabled, onStart, onFinish, onCancel }) {
  const self = mode === 'self';
  const active = holding === mode;
  const size = self ? 224 : 76;
  const radius = size / 2 - 7;
  const circumference = 2 * Math.PI * radius;
  const color = self ? '#ff698b' : '#7dcfff';

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={self ? "I'm in trouble" : 'Help someone else'}
      accessibilityHint="Hold for three seconds to start an emergency request. Release early to cancel."
      accessibilityState={{ disabled }} disabled={disabled} delayLongPress={3000}
      onPressIn={() => onStart(mode)} onPressOut={() => onCancel(mode)} onLongPress={() => onFinish(mode)}
      style={({ pressed }) => [self ? styles.sosHero : styles.helperCard, disabled && styles.disabled, pressed && styles.sosPressed]}>
      <View style={[self ? styles.sosHalo : styles.helperCircle, { width: size, height: size }]}>
        <Svg width={size} height={size} style={styles.ring}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={self ? '#6d263e' : '#2a4960'} strokeWidth={5} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={5} fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - (active ? 1 - remaining / 3000 : 0))}
            strokeLinecap="round" rotation={-90} origin={`${size / 2}, ${size / 2}`} />
        </Svg>
        <View style={self ? styles.sosCore : styles.helperCore}>
          <Ionicons name={self ? 'alert-circle-outline' : 'people-outline'} size={self ? 38 : 28} color={self ? '#fff' : '#7dcfff'} />
          {self ? <Text style={styles.sosWord}>{active ? `${Math.ceil(remaining / 1000)}s` : 'SOS'}</Text> : null}
          {self ? <Text style={styles.sosCaption}>{active ? 'Keep holding' : 'Hold for help'}</Text> : null}
        </View>
      </View>
      <View style={self ? styles.heroText : styles.helperText}>
        <Text style={self ? styles.heroTitle : styles.helperTitle}>{self ? "I'm in trouble" : 'Help someone else'}</Text>
        <Text style={styles.cardDescription}>{self ? 'Start an emergency request for yourself' : 'Scan their ID and request help'}</Text>
        <Text style={styles.holdLabel}>{active ? `Keep holding · ${Math.ceil(remaining / 1000)}s` : 'Hold for 3 seconds · release to cancel'}</Text>
      </View>
    </Pressable>
  );
}
