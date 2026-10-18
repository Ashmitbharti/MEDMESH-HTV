import { Alert, Platform } from 'react-native';

export function confirmAction(title, message, buttons) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) buttons.find((b) => b.style !== 'cancel')?.onPress?.();
  } else Alert.alert(title, message, buttons);
}
