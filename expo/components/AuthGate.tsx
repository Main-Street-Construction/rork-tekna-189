import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  LogIn, Clock, LogOut, RefreshCw, ShieldCheck,
  Search, GitFork, TreePine, Edit3, Heart,
  ChevronRight, ChevronLeft,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';

interface AuthGateProps {
  children: React.ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const { isSignedIn, isEnabled, sessionLoading, profileLoading, refreshProfile, signOut, signOutPending, user } = useAuth();

  if (sessionLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!isSignedIn) {
    return <SignInPrompt />;
  }

  if (profileLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.loadingText}>Checking account...</Text>
      </View>
    );
  }

  if (!isEnabled) {
    return (
      <PendingApproval
        email={user?.email ?? undefined}
        onRefresh={refreshProfile}
        onSignOut={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          void signOut();
        }}
        signOutPending={signOutPending}
      />
    );
  }

  return <>{children}</>;
}

function SignInPrompt() {
  const router = useRouter();

  return (
    <View style={styles.center}>
      <View style={styles.iconCircle}>
        <TreePine size={32} color={Colors.accent} />
      </View>
      <Text style={styles.title}>Family Tree</Text>
      <Text style={styles.description}>
        Sign in or create an account to explore your family history and discover connections across generations.
      </Text>
      <TouchableOpacity
        style={styles.signInBtn}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push('/auth');
        }}
        activeOpacity={0.8}
        testID="auth-gate-sign-in"
      >
        <LogIn size={18} color={Colors.white} />
        <Text style={styles.signInBtnText}>Get Started</Text>
      </TouchableOpacity>
    </View>
  );
}

interface TutorialTip {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
}

const TIPS: TutorialTip[] = [
  {
    icon: <Search size={24} color={Colors.male} />,
    title: 'Search & Explore',
    description: 'Find anyone in your family tree by name. Tap a person to view their details, family connections, and notes.',
    color: Colors.male,
  },
  {
    icon: <GitFork size={24} color={Colors.success} />,
    title: 'Discover Relationships',
    description: 'Pick any two people to find how they\'re connected. Claim your identity to see relationships to you automatically.',
    color: Colors.success,
  },
  {
    icon: <Heart size={24} color={Colors.female} />,
    title: 'Add Family Members',
    description: 'Add children, spouses, and create new family connections from any person\'s detail page.',
    color: Colors.female,
  },
  {
    icon: <Edit3 size={24} color={Colors.accent} />,
    title: 'Suggest Edits',
    description: 'Propose changes to names, dates, and notes. An admin will review your edits before they go live.',
    color: Colors.accent,
  },
];

interface PendingApprovalProps {
  email?: string;
  onRefresh: () => void;
  onSignOut: () => void;
  signOutPending: boolean;
}

function PendingApproval({ email, onRefresh, onSignOut, signOutPending }: PendingApprovalProps) {
  const [checking, setChecking] = useState<boolean>(false);
  const [currentTip, setCurrentTip] = useState<number>(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const handleCheck = useCallback(async () => {
    setChecking(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRefresh();
    setTimeout(() => setChecking(false), 2500);
  }, [onRefresh]);

  const animateToTip = useCallback((next: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const direction = next > currentTip ? -1 : 1;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: direction * 20, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      setCurrentTip(next);
      slideAnim.setValue(-direction * 20);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    });
  }, [currentTip, fadeAnim, slideAnim]);

  const nextTip = useCallback(() => {
    animateToTip(currentTip < TIPS.length - 1 ? currentTip + 1 : 0);
  }, [currentTip, animateToTip]);

  const prevTip = useCallback(() => {
    animateToTip(currentTip > 0 ? currentTip - 1 : TIPS.length - 1);
  }, [currentTip, animateToTip]);

  const tip = TIPS[currentTip];

  return (
    <ScrollView
      style={styles.pendingContainer}
      contentContainerStyle={styles.pendingContent}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View style={[styles.pendingIconCircle, { transform: [{ scale: pulseAnim }] }]}>
        <Clock size={36} color={Colors.accent} />
      </Animated.View>

      <Text style={styles.pendingTitle}>Awaiting Approval</Text>
      <Text style={styles.pendingDescription}>
        Your account has been created and is waiting for an administrator to grant access.
      </Text>

      {email && (
        <View style={styles.emailBadge}>
          <ShieldCheck size={14} color={Colors.textSecondary} />
          <Text style={styles.emailBadgeText}>{email}</Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.checkStatusBtn}
        onPress={handleCheck}
        disabled={checking}
        activeOpacity={0.8}
        testID="check-approval-status"
      >
        {checking ? (
          <ActivityIndicator size="small" color={Colors.accent} />
        ) : (
          <RefreshCw size={16} color={Colors.accent} />
        )}
        <Text style={styles.checkStatusText}>
          {checking ? 'Checking...' : 'Check Status'}
        </Text>
      </TouchableOpacity>

      <View style={styles.tutorialSection}>
        <Text style={styles.tutorialLabel}>WHILE YOU WAIT</Text>
        <Text style={styles.tutorialHeading}>Get to know the app</Text>

        <View style={styles.tipCard}>
          <View style={styles.tipNavRow}>
            <TouchableOpacity onPress={prevTip} style={styles.tipNavBtn} activeOpacity={0.6}>
              <ChevronLeft size={20} color={Colors.textLight} />
            </TouchableOpacity>
            <View style={styles.tipDots}>
              {TIPS.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.tipDot,
                    i === currentTip && { backgroundColor: tip.color, width: 16 },
                  ]}
                />
              ))}
            </View>
            <TouchableOpacity onPress={nextTip} style={styles.tipNavBtn} activeOpacity={0.6}>
              <ChevronRight size={20} color={Colors.textLight} />
            </TouchableOpacity>
          </View>

          <Animated.View
            style={[
              styles.tipContent,
              { opacity: fadeAnim, transform: [{ translateX: slideAnim }] },
            ]}
          >
            <View style={[styles.tipIconCircle, { backgroundColor: tip.color + '15' }]}>
              {tip.icon}
            </View>
            <Text style={styles.tipTitle}>{tip.title}</Text>
            <Text style={styles.tipDescription}>{tip.description}</Text>
          </Animated.View>
        </View>
      </View>

      <TouchableOpacity
        style={styles.signOutLink}
        onPress={onSignOut}
        disabled={signOutPending}
        activeOpacity={0.7}
      >
        {signOutPending ? (
          <ActivityIndicator size="small" color={Colors.danger} />
        ) : (
          <LogOut size={14} color={Colors.danger} />
        )}
        <Text style={styles.signOutLinkText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 60,
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 12,
    fontWeight: '500' as const,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  signInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 36,
    paddingVertical: 15,
    borderRadius: 14,
    gap: 8,
    width: '100%',
    marginBottom: 12,
  },
  signInBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  secondaryBtnText: {
    fontSize: 14,
    color: Colors.accent,
    fontWeight: '500' as const,
  },
  pendingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  pendingContent: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 40,
  },
  pendingIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  pendingTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  pendingDescription: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
    maxWidth: 300,
  },
  emailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
    marginBottom: 20,
  },
  emailBadgeText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  checkStatusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    gap: 8,
    marginBottom: 32,
  },
  checkStatusText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
  tutorialSection: {
    width: '100%',
    marginBottom: 32,
  },
  tutorialLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textLight,
    letterSpacing: 1.2,
    marginBottom: 6,
    textAlign: 'center',
  },
  tutorialHeading: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  tipCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  tipNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
  tipNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipDots: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  tipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.divider,
  },
  tipContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 8,
  },
  tipIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  tipTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  tipDescription: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  signOutLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  signOutLinkText: {
    fontSize: 14,
    color: Colors.danger,
    fontWeight: '500' as const,
  },
});
