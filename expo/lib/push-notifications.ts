import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerPushToken, unregisterPushToken } from './supabase-rpc';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let lastRegisteredToken: string | null = null;
let registrationInFlight: Promise<void> | null = null;
let appStateSub: { remove: () => void } | null = null;

function canRegisterToken(settings: Notifications.NotificationPermissionsStatus): boolean {
  if (settings.status === 'granted') return true;
  if (Platform.OS === 'ios') {
    const iosStatus = settings.ios?.status;
    return (
      iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
      iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  }
  return false;
}

async function ensurePushPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (canRegisterToken(existing)) return true;

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  return canRegisterToken(requested);
}

function resolveProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

async function registerOnce(): Promise<void> {
  if (!Device.isDevice) {
    console.log('[Push] Skipping — not a physical device');
    return;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Access requests',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const allowed = await ensurePushPermission();
  if (!allowed) {
    console.log('[Push] Permission not granted');
    return;
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    console.warn('[Push] Missing EAS projectId — cannot register a push token');
    return;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;

  if (token === lastRegisteredToken) {
    console.log('[Push] Token already registered');
    return;
  }

  const result = await registerPushToken(token, Platform.OS);
  if (!result.success) {
    console.warn('[Push] Failed to save token:', result.error);
    return;
  }

  lastRegisteredToken = token;
  console.log('[Push] Registered admin token');
}

export async function registerAdminPushNotifications(): Promise<void> {
  if (registrationInFlight) return registrationInFlight;

  registrationInFlight = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await registerOnce();
        return;
      } catch (e) {
        lastError = e;
        console.warn(`[Push] register attempt ${attempt + 1} failed:`, e);
        await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
      }
    }
    if (lastError) console.warn('[Push] register failed after retries:', lastError);
  })().finally(() => {
    registrationInFlight = null;
  });

  return registrationInFlight;
}

/** Re-register when the app returns to foreground (covers denied→granted flips). */
export function startAdminPushAutoReregister(): () => void {
  if (appStateSub) return () => appStateSub?.remove();

  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void registerAdminPushNotifications();
    }
  });

  return () => {
    appStateSub?.remove();
    appStateSub = null;
  };
}

export async function unregisterAdminPushNotifications(): Promise<void> {
  if (lastRegisteredToken) {
    await unregisterPushToken(lastRegisteredToken);
    lastRegisteredToken = null;
  }
}

export function addNotificationResponseListener(
  handler: (data: Record<string, unknown>) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown>;
    handler(data);
  });
}

export function getLastNotificationResponse(): Notifications.NotificationResponse | null {
  return Notifications.getLastNotificationResponse();
}
