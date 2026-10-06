import { createClient, SupportedStorage } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

/** AsyncStorage uses `window` on web and breaks Expo static/SSR export in Node. */
const memoryStorage: SupportedStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

const canUseBrowserStorage = typeof window !== 'undefined';

const authStorage: SupportedStorage = canUseBrowserStorage ? AsyncStorage : memoryStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: canUseBrowserStorage,
    persistSession: canUseBrowserStorage,
    detectSessionInUrl: Platform.OS === 'web' && canUseBrowserStorage,
  },
});
