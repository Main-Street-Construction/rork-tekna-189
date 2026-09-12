import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  Animated,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ShieldCheck, Lock, Eye, EyeOff, CheckCircle, ArrowLeft, AlertTriangle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useMutation } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAndroidKeyboardScroll } from '@/lib/keyboard-scroll';

export default function UpdatePasswordScreen() {
  const router = useRouter();

  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [success, setSuccess] = useState<boolean>(false);
  const { scrollRef, keyboardPadding, onScrollOffset, fieldProps } = useAndroidKeyboardScroll();

  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  const updatePasswordMutation = useMutation({
    mutationFn: async (password: string) => {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setSuccess(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      Animated.parallel([
        Animated.spring(successScale, {
          toValue: 1,
          friction: 5,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(successOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    },
    onError: (error: Error) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = error.message;
      if (msg.includes('should be different')) {
        setErrorMessage('New password must be different from your current password.');
      } else if (msg.includes('expired') || msg.includes('invalid')) {
        setErrorMessage('This reset link has expired. Please request a new one.');
      } else {
        setErrorMessage(msg || 'Failed to update password. Please try again.');
      }
    },
  });

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/');
        }
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [success, router]);

  const handleSubmit = useCallback(() => {
    setErrorMessage('');

    if (!newPassword.trim()) {
      setErrorMessage('Please enter a new password.');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    updatePasswordMutation.mutate(newPassword);
  }, [newPassword, confirmPassword, updatePasswordMutation]);

  const isPending = updatePasswordMutation.isPending;

  if (success) {
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{
            title: '',
            headerStyle: { backgroundColor: Colors.background },
            headerShadowVisible: false,
            headerLeft: () => null,
          }}
        />
        <View style={styles.successContainer}>
          <Animated.View
            style={[
              styles.successIconCircle,
              {
                transform: [{ scale: successScale }],
                opacity: successOpacity,
              },
            ]}
          >
            <CheckCircle size={48} color={Colors.success} />
          </Animated.View>
          <Text style={styles.successTitle}>Password Updated</Text>
          <Text style={styles.successSubtitle}>
            Your password has been changed successfully. Redirecting you now...
          </Text>
          <View style={styles.successProgressBar}>
            <Animated.View style={styles.successProgressFill} />
          </View>
        </View>
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
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/');
                }
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
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
          ref={scrollRef}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + keyboardPadding }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          onScroll={(e) => onScrollOffset(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
        >
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <ShieldCheck size={28} color={Colors.accent} />
            </View>
            <Text style={styles.title}>Set New Password</Text>
            <Text style={styles.subtitle}>
              Choose a strong password for your account
            </Text>
          </View>

          {errorMessage ? (
            <View style={styles.errorBanner}>
              <AlertTriangle size={16} color={Colors.danger} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <View style={styles.inputRow} {...fieldProps('newPassword')}>
                <Lock size={18} color={Colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="New Password"
                  placeholderTextColor={Colors.textLight}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  onFocus={fieldProps('newPassword').onFocus}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="update-password-new"
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

              <View style={styles.inputDivider} />

              <View style={styles.inputRow} {...fieldProps('confirmPassword')}>
                <Lock size={18} color={Colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm Password"
                  placeholderTextColor={Colors.textLight}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  onFocus={fieldProps('confirmPassword').onFocus}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="update-password-confirm"
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword((p) => !p)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={18} color={Colors.textLight} />
                  ) : (
                    <Eye size={18} color={Colors.textLight} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.requirementsList}>
              <View style={styles.requirementRow}>
                <View
                  style={[
                    styles.requirementDot,
                    newPassword.length >= 6 && styles.requirementDotMet,
                  ]}
                />
                <Text
                  style={[
                    styles.requirementText,
                    newPassword.length >= 6 && styles.requirementTextMet,
                  ]}
                >
                  At least 6 characters
                </Text>
              </View>
              <View style={styles.requirementRow}>
                <View
                  style={[
                    styles.requirementDot,
                    confirmPassword.length > 0 &&
                      newPassword === confirmPassword &&
                      styles.requirementDotMet,
                  ]}
                />
                <Text
                  style={[
                    styles.requirementText,
                    confirmPassword.length > 0 &&
                      newPassword === confirmPassword &&
                      styles.requirementTextMet,
                  ]}
                >
                  Passwords match
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, isPending && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={isPending}
              activeOpacity={0.8}
              testID="update-password-submit"
            >
              {isPending ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <ShieldCheck size={18} color={Colors.white} />
                  <Text style={styles.submitBtnText}>Update Password</Text>
                </>
              )}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '500' as const,
    lineHeight: 18,
    flex: 1,
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
  requirementsList: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  requirementDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textLight,
  },
  requirementDotMet: {
    backgroundColor: Colors.success,
  },
  requirementText: {
    fontSize: 13,
    color: Colors.textLight,
    fontWeight: '500' as const,
  },
  requirementTextMet: {
    color: Colors.success,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 52,
    gap: 8,
    marginTop: 4,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  successIconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(74, 124, 89, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 10,
  },
  successSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  successProgressBar: {
    width: 120,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(74, 124, 89, 0.15)',
    overflow: 'hidden',
  },
  successProgressFill: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.success,
    borderRadius: 2,
  },
});
