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
  primary: '#3A4540',
  primaryLight: '#4A564F',
  accent: '#B88968',
  accentLight: '#C89A7A',
  accentDark: '#9A734F',
  accentMuted: 'rgba(184, 137, 104, 0.12)',
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
  success: '#5A7A64',
  successMuted: 'rgba(90, 122, 100, 0.1)',
  danger: '#C45C4A',
  dangerMuted: 'rgba(196, 92, 74, 0.1)',
  male: '#5B7FA6',
  female: '#B06A8F',
  searchBar: '#EDE5DD',
  tabBar: '#FDFBF9',
  headerBg: '#3A4540',
  headerText: '#F5F0EB',
  overlay: 'rgba(58, 69, 64, 0.08)',
  statusBarStyle: 'dark',
};

export const darkColors: ColorPalette = {
  // Elevated enough to read as a button on background — not near-black green.
  primary: '#5A6E62',
  primaryLight: '#6B8174',
  accent: '#B88968',
  accentLight: '#C89A7A',
  accentDark: '#9A734F',
  accentMuted: 'rgba(184, 137, 104, 0.2)',
  background: '#141816',
  backgroundDark: '#0E100F',
  card: '#1C2220',
  cardBorder: '#323A36',
  text: '#F5F0EB',
  textSecondary: '#A89F94',
  textLight: '#7A7168',
  white: '#FFFFFF',
  black: '#0A0C0B',
  divider: '#2A312D',
  success: '#6A8574',
  successMuted: 'rgba(106, 133, 116, 0.16)',
  danger: '#D47473',
  dangerMuted: 'rgba(212, 116, 115, 0.16)',
  male: '#7A9FC4',
  female: '#C88AAD',
  searchBar: '#222926',
  tabBar: '#181C1A',
  headerBg: '#181C1A',
  headerText: '#F5F0EB',
  overlay: 'rgba(245, 240, 235, 0.1)',
  statusBarStyle: 'light',
};

/** @deprecated Prefer useColors() from ThemeContext for theme-aware UI */
const Colors = lightColors;
export default Colors;
