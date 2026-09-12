import { Platform } from 'react-native';
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

export async function registerAdminPushNotifications(): Promise<void> {
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

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Permission not granted');
    return;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn('[Push] Missing EAS projectId — cannot register a push token');
    return;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;

  if (token === lastRegisteredToken) return;

  const result = await registerPushToken(token, Platform.OS);
  if (!result.success) {
    console.warn('[Push] Failed to save token:', result.error);
    return;
  }

  lastRegisteredToken = token;
  console.log('[Push] Registered admin token');
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
