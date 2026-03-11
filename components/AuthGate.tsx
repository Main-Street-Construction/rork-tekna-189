import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Lock, LogIn, Clock, LogOut, RefreshCw, ShieldCheck } from 'lucide-react-native';
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
        <Lock size={32} color={Colors.accent} />
      </View>
      <Text style={styles.title}>Sign In Required</Text>
      <Text style={styles.description}>
        Sign in to access the family tree database. You'll need an approved account to view data.
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
        <Text style={styles.signInBtnText}>Sign In</Text>
      </TouchableOpacity>
    </View>
  );
}

interface PendingApprovalProps {
  email?: string;
  onRefresh: () => void;
  onSignOut: () => void;
  signOutPending: boolean;
}

function PendingApproval({ email, onRefresh, onSignOut, signOutPending }: PendingApprovalProps) {
  const [checking, setChecking] = React.useState<boolean>(false);

  const handleCheck = React.useCallback(async () => {
    setChecking(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRefresh();
    setTimeout(() => setChecking(false), 2000);
  }, [onRefresh]);

  return (
    <View style={styles.center}>
      <View style={styles.pendingIconCircle}>
        <Clock size={36} color={Colors.accent} />
      </View>
      <Text style={styles.title}>Awaiting Approval</Text>
      <Text style={styles.description}>
        Your account has been created but needs to be approved by an administrator before you can access the family tree.
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
    </View>
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
  pendingIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  signInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  signInBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  emailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.overlay,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
    marginBottom: 24,
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
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    marginBottom: 20,
  },
  checkStatusText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.accent,
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
