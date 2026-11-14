export type ColorPalette = {
  primary: string;
  primaryLight: string;
  accent: string;
  accentLight: string;
  accentDark: string;
  accentMuted: string;
  background: string;
  backgroundDark: string;
  card: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  textLight: string;
  white: string;
  black: string;
  divider: string;
  success: string;
  successMuted: string;
  danger: string;
  dangerMuted: string;
  male: string;
  female: string;
  searchBar: string;
  tabBar: string;
  headerBg: string;
  headerText: string;
  overlay: string;
  statusBarStyle: 'light' | 'dark';
};

export const lightColors: ColorPalette = {
  primary: '#2C3930',
  primaryLight: '#3D4F42',
  accent: '#C8956C',
  accentLight: '#D4A87C',
  accentDark: '#A67A52',
  accentMuted: 'rgba(200, 149, 108, 0.12)',
  background: '#F5F0EB',
  backgroundDark: '#EDE5DD',
  card: '#FFFFFF',
  cardBorder: '#E8DED4',
  text: '#2D2A26',
  textSecondary: '#7A7168',
  textLight: '#A49A8E',
  white: '#FFFFFF',
  black: '#1A1816',
  divider: '#E8DED4',
  success: '#4A7C59',
  successMuted: 'rgba(74, 124, 89, 0.08)',
  danger: '#C45C4A',
  dangerMuted: 'rgba(196, 92, 74, 0.1)',
  male: '#5B7FA6',
  female: '#B06A8F',
  searchBar: '#EDE5DD',
  tabBar: '#FDFBF9',
  headerBg: '#2C3930',
  headerText: '#F5F0EB',
  overlay: 'rgba(44, 57, 48, 0.08)',
  statusBarStyle: 'dark',
};

export const darkColors: ColorPalette = {
  primary: '#1A2420',
  primaryLight: '#2A3830',
  accent: '#C8956C',
  accentLight: '#D4A87C',
  accentDark: '#A67A52',
  accentMuted: 'rgba(200, 149, 108, 0.18)',
  background: '#141A16',
  backgroundDark: '#0F1411',
  card: '#1E2820',
  cardBorder: '#2F3B34',
  text: '#F5F0EB',
  textSecondary: '#A89F94',
  textLight: '#7A7168',
  white: '#FFFFFF',
  black: '#0A0C0B',
  divider: '#2F3B34',
  success: '#6A9B78',
  successMuted: 'rgba(106, 155, 120, 0.16)',
  danger: '#D47473',
  dangerMuted: 'rgba(212, 116, 115, 0.16)',
  male: '#7A9FC4',
  female: '#C88AAD',
  searchBar: '#1A2420',
  tabBar: '#1A2420',
  headerBg: '#1A2420',
  headerText: '#F5F0EB',
  overlay: 'rgba(245, 240, 235, 0.08)',
  statusBarStyle: 'light',
};

/** @deprecated Prefer useColors() from ThemeContext for theme-aware UI */
const Colors = lightColors;
export default Colors;
