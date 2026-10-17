import { Platform } from 'react-native';

// Same palette as the MedMesh v4 prototype, so the app and command centre look like one product.
export const c = {
  bg: '#05070f',
  panel: '#0b1020',
  panel2: '#0f1629',
  line: 'rgba(255,255,255,0.08)',
  line2: 'rgba(255,255,255,0.14)',
  ink: '#eef1f7',
  muted: '#9ca3af',
  dim: '#6b7280',
  sky: '#7dd3fc',
  sky4: '#38bdf8',
  blue: '#3b82f6',
  blue6: '#2563eb',
  green: '#34d399',
  red: '#ef4444',
  redl: '#fca5a5',
  amber: '#fbbf24',
  violet: '#a78bfa',
};

export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });

export const grad = {
  primary: ['#38bdf8', '#2563eb'],
  card: ['#0c2a52', '#0b1730', '#08101f'],
  glow: ['rgba(56,189,248,0.28)', 'rgba(5,7,15,0)'],
};
