export const Colors = {
  primary: '#1d1d1f',
  secondary: '#86868b',
  background: '#ffffff',
  backgroundSecondary: '#f5f5f7',
  accent: '#2490f8',
  accentHover: '#1a7de6',
  border: '#d2d2d7',
  borderLight: '#e8e8ed',
  success: '#30d158',
  error: '#ff375f',
  warning: '#ff9f0a',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Typography = {
  h1: { fontSize: 32, fontWeight: '600' as const, letterSpacing: -0.5 },
  h2: { fontSize: 24, fontWeight: '600' as const, letterSpacing: -0.2 },
  h3: { fontSize: 21, fontWeight: '600' as const, letterSpacing: -0.1 },
  body: { fontSize: 17, fontWeight: '400' as const, lineHeight: 25 },
  caption: { fontSize: 14, fontWeight: '400' as const, color: Colors.secondary },
};

export const BorderRadius = {
  sm: 5,
  md: 12,
  lg: 18,
  xl: 24,
  full: 9999,
};
