import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Mail, Lock, LogIn, UserPlus, ArrowLeft, Eye, EyeOff, CheckCircle, Send } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';

type AuthMode = 'signup' | 'signin' | 'reset' | 'confirm_email';

export default function AuthScreen() {
  const router = useRouter();
  const {
    signIn, signUp, resetPassword, resendConfirmation,
    signInPending, signUpPending, resetPasswordPending, resendConfirmationPending,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('signup');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [pendingEmail, setPendingEmail] = useState<string>('');

  const isPending = signInPending || signUpPending || resetPasswordPending;

  const handleSubmit = useCallback(async () => {
    setErrorMessage('');
    setSuccessMessage('');

    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    if (mode === 'reset') {
      try {
        await resetPassword(email.trim());
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSuccessMessage('Password reset email sent! Check your inbox (and spam folder).');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);

        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setErrorMessage(msg);
      }
      return;
    }

    if (!password.trim()) {
      setErrorMessage('Please enter a password.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setErrorMessage('Passwords do not match.');
        return;
      }
    }

    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      } else {
        const result = await signUp(email.trim(), password);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (result.needsEmailConfirmation) {

          setPendingEmail(email.trim());
          setMode('confirm_email');
        } else {
          router.back();
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (msg.includes('Email not confirmed')) {
        setPendingEmail(email.trim());
        setMode('confirm_email');
      } else if (msg.includes('Invalid login credentials')) {
        setErrorMessage('Invalid email or password. Check your credentials or create a new account.');
      } else if (msg.includes('User already registered')) {
        setErrorMessage('An account with this email already exists. Try signing in instead.');
      } else {
        setErrorMessage(msg);
      }
    }
  }, [email, password, confirmPassword, mode, signIn, signUp, resetPassword, router]);

  const handleResendConfirmation = useCallback(async () => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await resendConfirmation(pendingEmail);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccessMessage('Confirmation email resent! Check your inbox and spam folder.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(msg);
    }
  }, [pendingEmail, resendConfirmation]);

  const toggleMode = useCallback((target?: AuthMode) => {
    if (target) {
      setMode(target);
    } else {
      setMode((prev) => (prev === 'signin' ? 'signup' : 'signin'));
    }
    setErrorMessage('');
    setSuccessMessage('');
    setConfirmPassword('');
  }, []);

  if (mode === 'confirm_email') {
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{
            title: '',
            headerStyle: { backgroundColor: Colors.background },
            headerShadowVisible: false,
            headerLeft: () => (
              <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <ArrowLeft size={24} color={Colors.text} />
              </TouchableOpacity>
            ),
          }}
        />
        <ScrollView
          contentContainerStyle={styles.confirmContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.confirmIconCircle}>
            <Mail size={36} color={Colors.success} />
          </View>
          <Text style={styles.confirmTitle}>Check Your Email</Text>
          <Text style={styles.confirmDescription}>
            We sent a confirmation link to:
          </Text>
          <View style={styles.emailHighlight}>
            <Text style={styles.emailHighlightText}>{pendingEmail}</Text>
          </View>
          <Text style={styles.confirmDescription}>
            Click the link in the email to verify your account, then come back here and sign in.
          </Text>

          <View style={styles.confirmSteps}>
            <View style={styles.stepRow}>
              <View style={[styles.stepBadge, styles.stepBadgeActive]}>
                <CheckCircle size={14} color={Colors.white} />
              </View>
              <Text style={styles.stepText}>Account created</Text>
            </View>
            <View style={styles.stepConnector} />
            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeNumber}>2</Text>
              </View>
              <Text style={styles.stepText}>Confirm your email</Text>
            </View>
            <View style={styles.stepConnector} />
            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeNumber}>3</Text>
              </View>
              <Text style={styles.stepText}>Sign in & await admin approval</Text>
            </View>
          </View>

          {successMessage ? (
            <View style={styles.successBanner}>
              <Text style={styles.successText}>{successMessage}</Text>
            </View>
          ) : null}

          {errorMessage ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.signInAfterConfirmBtn}
            onPress={() => toggleMode('signin')}
            activeOpacity={0.8}
          >
            <LogIn size={18} color={Colors.white} />
            <Text style={styles.submitBtnText}>I've Confirmed — Sign In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendBtn}
            onPress={handleResendConfirmation}
            disabled={resendConfirmationPending}
            activeOpacity={0.7}
          >
            {resendConfirmationPending ? (
              <ActivityIndicator size="small" color={Colors.accent} />
            ) : (
              <Send size={15} color={Colors.accent} />
            )}
            <Text style={styles.resendBtnText}>
              {resendConfirmationPending ? 'Sending...' : 'Resend Confirmation Email'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: '',
          headerStyle: { backgroundColor: Colors.background },
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <ArrowLeft size={24} color={Colors.text} />
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              {mode === 'signin' ? (
                <LogIn size={28} color={Colors.accent} />
              ) : mode === 'reset' ? (
                <Mail size={28} color={Colors.accent} />
              ) : (
                <UserPlus size={28} color={Colors.accent} />
              )}
            </View>
            <Text style={styles.title}>
              {mode === 'signin' ? 'Welcome Back' : mode === 'reset' ? 'Reset Password' : 'Create Account'}
            </Text>
            <Text style={styles.subtitle}>
              {mode === 'signin'
                ? 'Sign in to access the family tree'
                : mode === 'reset'
                ? 'Enter your email and we\'ll send a reset link'
                : 'Join to explore your family history'}
            </Text>
          </View>

          {successMessage ? (
            <View style={styles.successBanner}>
              <Text style={styles.successText}>{successMessage}</Text>
            </View>
          ) : null}

          {errorMessage ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <View style={styles.inputRow}>
                <Mail size={18} color={Colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor={Colors.textLight}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="auth-email-input"
                />
              </View>

              {mode !== 'reset' && (
                <>
                  <View style={styles.inputDivider} />
                  <View style={styles.inputRow}>
                    <Lock size={18} color={Colors.textSecondary} />
                    <TextInput
                      style={styles.input}
                      placeholder="Password"
                      placeholderTextColor={Colors.textLight}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      testID="auth-password-input"
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword((p) => !p)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      {showPassword ? (
                        <EyeOff size={18} color={Colors.textLight} />
                      ) : (
                        <Eye size={18} color={Colors.textLight} />
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {mode === 'signup' && (
                <>
                  <View style={styles.inputDivider} />
                  <View style={styles.inputRow}>
                    <Lock size={18} color={Colors.textSecondary} />
                    <TextInput
                      style={styles.input}
                      placeholder="Confirm Password"
                      placeholderTextColor={Colors.textLight}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      testID="auth-confirm-password-input"
                    />
                  </View>
                </>
              )}
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, isPending && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={isPending}
              activeOpacity={0.8}
              testID="auth-submit-btn"
            >
              {isPending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  {mode === 'signin' ? (
                    <LogIn size={18} color={Colors.white} />
                  ) : mode === 'reset' ? (
                    <Mail size={18} color={Colors.white} />
                  ) : (
                    <UserPlus size={18} color={Colors.white} />
                  )}
                  <Text style={styles.submitBtnText}>
                    {mode === 'signin' ? 'Sign In' : mode === 'reset' ? 'Send Reset Link' : 'Create Account'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {mode === 'signin' && (
              <TouchableOpacity
                style={styles.forgotBtn}
                onPress={() => toggleMode('reset')}
                activeOpacity={0.7}
              >
                <Text style={styles.forgotBtnText}>Forgot Password?</Text>
              </TouchableOpacity>
            )}

            {mode === 'signup' && (
              <View style={styles.noteBanner}>
                <Text style={styles.noteText}>
                  After creating your account, you'll need to confirm your email and then an admin will review your access.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>
              {mode === 'reset'
                ? 'Remember your password?'
                : mode === 'signin'
                ? "Don't have an account?"
                : 'Already have an account?'}
            </Text>
            <TouchableOpacity onPress={() => toggleMode(mode === 'reset' ? 'signin' : undefined)} activeOpacity={0.7}>
              <Text style={styles.switchLink}>
                {mode === 'reset' ? 'Sign In' : mode === 'signin' ? 'Sign Up' : 'Sign In'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 32,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  errorBanner: {
    backgroundColor: 'rgba(196, 92, 74, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(196, 92, 74, 0.2)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '500' as const,
    lineHeight: 18,
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 52,
    gap: 12,
  },
  inputDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginLeft: 44,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    height: 52,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 52,
    gap: 8,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  successBanner: {
    backgroundColor: 'rgba(74, 124, 89, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(74, 124, 89, 0.2)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  successText: {
    fontSize: 13,
    color: '#4A7C59',
    fontWeight: '500' as const,
    lineHeight: 18,
  },
  forgotBtn: {
    alignItems: 'center' as const,
    paddingVertical: 10,
  },
  forgotBtnText: {
    fontSize: 14,
    color: Colors.accent,
    fontWeight: '500' as const,
  },
  noteBanner: {
    backgroundColor: 'rgba(200, 149, 108, 0.1)',
    borderRadius: 10,
    padding: 12,
  },
  noteText: {
    fontSize: 12,
    color: Colors.accent,
    fontWeight: '500' as const,
    lineHeight: 17,
    textAlign: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 28,
  },
  switchText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  switchLink: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
  confirmContent: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 40,
    alignItems: 'center',
  },
  confirmIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(74, 124, 89, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  confirmTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  confirmDescription: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 8,
  },
  emailHighlight: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
  },
  emailHighlightText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  confirmSteps: {
    width: '100%',
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 18,
    marginTop: 20,
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBadgeActive: {
    backgroundColor: Colors.success,
  },
  stepBadgeNumber: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
  },
  stepText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
    flex: 1,
  },
  stepConnector: {
    width: 2,
    height: 16,
    backgroundColor: Colors.divider,
    marginLeft: 13,
  },
  signInAfterConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 52,
    gap: 8,
    width: '100%',
    marginBottom: 12,
  },
  resendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
  },
  resendBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
});
