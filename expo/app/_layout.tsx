import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState, useCallback } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AuthProvider } from "@/contexts/AuthContext";
import { FamilyTreeProvider } from "@/contexts/FamilyTreeContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { SearchHistoryProvider } from "@/contexts/SearchHistoryContext";
import OnboardingTutorial from "@/components/OnboardingTutorial";
import Colors from "@/constants/colors";
import { trpc, trpcClient } from "@/lib/trpc";
import {
  addNotificationResponseListener,
  getLastNotificationResponse,
} from "@/lib/push-notifications";

void SplashScreen.preventAutoHideAsync();

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
  return (
    <>
      <NotificationDeepLinkHandler />
      <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.text,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="person/[id]"
        options={{ title: "Person" }}
      />
      <Stack.Screen
        name="import-data/index"
        options={{ presentation: "modal", title: "Import Data" }}
      />
      <Stack.Screen
        name="edit-person/[id]"
        options={{ presentation: "modal", title: "Edit Person" }}
      />
      <Stack.Screen
        name="add-child/[parentId]"
        options={{ presentation: "modal", title: "Add Child" }}
      />
      <Stack.Screen
        name="add-spouse/[personId]"
        options={{ presentation: "modal", title: "Add Spouse" }}
      />
      <Stack.Screen
        name="pending-edits/index"
        options={{ title: "Pending Edits" }}
      />
      <Stack.Screen
        name="link-spouses/index"
        options={{ presentation: "modal", title: "Link Spouses" }}
      />
      <Stack.Screen
        name="edit-marriage/[familyId]"
        options={{ presentation: "modal", title: "Edit Marriage" }}
      />
      <Stack.Screen
        name="auth"
        options={{ presentation: "modal", title: "Account" }}
      />
      <Stack.Screen
        name="admin/index"
        options={{ title: "Admin Panel" }}
      />
      <Stack.Screen
        name="admin/data"
        options={{ title: "Data Console" }}
      />
      <Stack.Screen
        name="privacy-policy/index"
        options={{ title: "Privacy Policy" }}
      />
      <Stack.Screen
        name="update-password"
        options={{ presentation: "modal", title: "Update Password" }}
      />
    </Stack>
    </>
  );
}

const ONBOARDING_KEY = 'onboarding_completed';

export default function RootLayout() {
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [onboardingChecked, setOnboardingChecked] = useState<boolean>(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then((value) => {
      if (value !== 'true') {
        setShowOnboarding(true);
      }
      setOnboardingChecked(true);
      void SplashScreen.hideAsync();
    }).catch(() => {
      setOnboardingChecked(true);
      void SplashScreen.hideAsync();
    });
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    AsyncStorage.setItem(ONBOARDING_KEY, 'true').catch(() => {});
  }, []);

  if (!onboardingChecked) return null;

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <AuthProvider>
            <FamilyTreeProvider>
              <ProfileProvider>
                <SearchHistoryProvider>
                  <RootLayoutNav />
                  {showOnboarding && (
                    <OnboardingTutorial onComplete={handleOnboardingComplete} />
                  )}
                </SearchHistoryProvider>
              </ProfileProvider>
            </FamilyTreeProvider>
          </AuthProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
