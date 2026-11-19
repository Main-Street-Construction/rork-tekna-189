import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Platform, StatusBar } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "@/contexts/AuthContext";
import { FamilyTreeProvider } from "@/contexts/FamilyTreeContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { SearchHistoryProvider } from "@/contexts/SearchHistoryContext";
import { OnboardingProvider, useOnboarding } from "@/contexts/OnboardingContext";
import { ThemeProvider, useColors, useTheme } from "@/contexts/ThemeContext";
import OnboardingTutorial from "@/components/OnboardingTutorial";
import {
  addNotificationResponseListener,
  getLastNotificationResponse,
} from "@/lib/push-notifications";

if (Platform.OS !== "web") {
  void SplashScreen.preventAutoHideAsync().catch(() => {});
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

function NotificationDeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    const navigateFromNotification = (data: Record<string, unknown>) => {
      if (data.type === 'access_request') {
        router.push('/admin');
      }
    };

    const last = getLastNotificationResponse();
    if (last) {
      const data = last.notification.request.content.data as Record<string, unknown>;
      navigateFromNotification(data);
    }

    const sub = addNotificationResponseListener(navigateFromNotification);
    return () => sub.remove();
  }, [router]);

  return null;
}

function RootLayoutNav() {
  const colors = useColors();
  const { scheme } = useTheme();
  const screenOptions = useMemo(() => ({
    headerBackTitle: '',
    headerBackButtonDisplayMode: 'minimal' as const,
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: colors.background },
  }), [colors]);

  // Keep Android system bars in sync with theme (status + navigation / edge-to-edge).
  useEffect(() => {
    if (Platform.OS === "web") return;
    void import("expo-system-ui")
      .then((SystemUI) => SystemUI.setBackgroundColorAsync(colors.background))
      .catch(() => {});
  }, [colors.background]);

  return (
    <>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <NotificationDeepLinkHandler />
      <Stack screenOptions={screenOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="person/[id]"
        options={{
          title: "Person",
          headerBackVisible: true,
          headerBackButtonDisplayMode: "minimal",
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="tree/[id]"
        options={{
          title: "Tree Explorer",
          headerShown: false,
          gestureEnabled: true,
          animation: "fade",
        }}
      />
      <Stack.Screen
        name="import-data/index"
        options={{ presentation: "modal", title: "Import Data", gestureEnabled: true }}
      />
      <Stack.Screen
        name="edit-person/[id]"
        options={{ presentation: "modal", title: "Edit Person", gestureEnabled: true }}
      />
      <Stack.Screen
        name="add-child/[parentId]"
        options={{ presentation: "modal", title: "Add Child", gestureEnabled: true }}
      />
      <Stack.Screen
        name="add-spouse/[personId]"
        options={{ presentation: "modal", title: "Add Spouse", gestureEnabled: true }}
      />
      <Stack.Screen
        name="pending-edits/index"
        options={{ title: "Pending Edits", headerBackVisible: true, gestureEnabled: true }}
      />
      <Stack.Screen
        name="link-spouses/index"
        options={{ presentation: "modal", title: "Link Spouses", gestureEnabled: true }}
      />
      <Stack.Screen
        name="edit-marriage/[familyId]"
        options={{ presentation: "modal", title: "Edit Marriage", gestureEnabled: true }}
      />
      <Stack.Screen
        name="auth"
        options={{
          presentation: Platform.OS === "android" ? "card" : "modal",
          title: "Account",
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="admin/index"
        options={{ title: "Admin Panel", headerBackVisible: true, gestureEnabled: true }}
      />
      <Stack.Screen
        name="admin/data"
        options={{ title: "Data Console", headerBackVisible: true, gestureEnabled: true }}
      />
      <Stack.Screen
        name="privacy-policy/index"
        options={{ title: "Privacy Policy", headerBackVisible: true, gestureEnabled: true }}
      />
      <Stack.Screen
        name="link-child/[parentId]"
        options={{ presentation: "modal", title: "Link Child", gestureEnabled: true }}
      />
      <Stack.Screen
        name="merge-person/[id]"
        options={{ presentation: "modal", title: "Merge People", gestureEnabled: true }}
      />
      <Stack.Screen
        name="update-password"
        options={{
          presentation: Platform.OS === "android" ? "card" : "modal",
          title: "Update Password",
          gestureEnabled: true,
        }}
      />
    </Stack>
    </>
  );
}

function OnboardingOverlay() {
  const { showOnboarding, completeTutorial } = useOnboarding();
  if (!showOnboarding) return null;
  return <OnboardingTutorial onComplete={completeTutorial} />;
}

function RootLayoutInner() {
  const [splashReady, setSplashReady] = useState<boolean>(Platform.OS === "web");
  const { onboardingChecked } = useOnboarding();

  useEffect(() => {
    if (!onboardingChecked) return;
    if (Platform.OS === "web") {
      setSplashReady(true);
      return;
    }
    void SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setSplashReady(true));
  }, [onboardingChecked]);

  // Never block the web shell on native splash APIs — that yields a blank page.
  if (Platform.OS !== "web" && (!onboardingChecked || !splashReady)) return null;
  if (Platform.OS === "web" && !onboardingChecked) return null;

  return (
    <ThemeProvider>
      <AuthProvider>
        <FamilyTreeProvider>
          <ProfileProvider>
            <SearchHistoryProvider>
              <RootLayoutNav />
              <OnboardingOverlay />
            </SearchHistoryProvider>
          </ProfileProvider>
        </FamilyTreeProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <OnboardingProvider>
          <RootLayoutInner />
        </OnboardingProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
