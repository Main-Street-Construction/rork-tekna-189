import React, { useState, useCallback, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import {
  User,
  Mail,
  TreePine,
  Check,
  Database,
  Trash2,
  ChevronRight,
  Search,
  X,
  Shield,
  AlertTriangle,
  MessageSquare,
  Send,
  RefreshCw,
  ShieldCheck,
  ClipboardList,
  Lock,
  LogIn,
  LogOut,
  Users,
  FileText,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { submitFeedback } from '@/lib/supabase-db';
import Colors from '@/constants/colors';
import { useProfile } from '@/contexts/ProfileContext';
import { useFamilyTree } from '@/contexts/FamilyTreeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
import { GedcomIndividual } from '@/types/genealogy';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, hasProfile, hasClaimed, isClaimed, saveProfile, claimIdentity, resetClaim, isSaving } = useProfile();
  const {
    hasData, individualCount, familyCount, clearData, search, getPerson,
    isAdmin,
    pendingEditCount, refreshPendingCount,
    isLoadingFromCloud, cloudError, loadProgress, refreshFromCloud,
  } = useFamilyTree();
  const { isSignedIn, user, signOut, signOutPending, isEnabled } = useAuth();

  const [displayName, setDisplayName] = useState<string>(
    profile?.displayName ?? ''
  );
  const [email, setEmail] = useState<string>(profile?.email ?? '');
  const [isEditing, setIsEditing] = useState<boolean>(!hasProfile);
  const [claimQuery, setClaimQuery] = useState<string>('');
  const [claimResults, setClaimResults] = useState<GedcomIndividual[]>([]);
  const [showClaimSearch, setShowClaimSearch] = useState<boolean>(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [feedbackEmail, setFeedbackEmail] = useState<string>('');
  const [feedbackSent, setFeedbackSent] = useState<boolean>(false);
  const feedbackMutation = useMutation({
    mutationFn: async (params: { message: string; contactEmail?: string }) => {
      const result = await submitFeedback(params.message, profile?.displayName || undefined, params.contactEmail || undefined);
      if (!result.success) throw new Error(result.error ?? 'Failed to send feedback.');
      return result;
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFeedbackMessage('');
      setFeedbackEmail('');
      setFeedbackSent(true);
      setTimeout(() => setFeedbackSent(false), 4000);
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message || 'Something went wrong sending feedback.');
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return refreshFromCloud();
    },
  });

  useEffect(() => {
    if (isAdmin) {
      void refreshPendingCount();
    }
  }, [isAdmin, refreshPendingCount]);

  const handleSave = useCallback(() => {
    if (!displayName.trim()) {
      Alert.alert('Name Required', 'Please enter your display name.');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    saveProfile({
      displayName: displayName.trim(),
      email: email.trim() || undefined,
    });
    setIsEditing(false);
  }, [displayName, email, saveProfile]);

  const handleClearData = useCallback(() => {
    Alert.alert(
      'Clear Family Data',
      'This will remove all imported GEDCOM data. Your profile and search history will be kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Data',
          style: 'destructive',
          onPress: () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            clearData();
          },
        },
      ]
    );
  }, [clearData]);

  const handleImport = useCallback(() => {
    router.push('/import-data');
  }, [router]);

  const handleClaimSearch = useCallback(
    (text: string) => {
      setClaimQuery(text);
      if (text.trim().length >= 2) {
        const found = search(text);
        setClaimResults(found.slice(0, 30));
      } else {
        setClaimResults([]);
      }
    },
    [search]
  );

  const handleClaimPerson = useCallback(
    (person: GedcomIndividual) => {
      Keyboard.dismiss();
      Alert.alert(
        'Claim Your Identity',
        `Are you sure you want to claim "${person.name}" as yourself?\n\nThis cannot be changed later.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Claim',
            style: 'default',
            onPress: async () => {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await claimIdentity(person.id, person.name);
              setShowClaimSearch(false);
              setClaimQuery('');
              setClaimResults([]);
              setDisplayName(person.name);
            },
          },
        ]
      );
    },
    [claimIdentity]
  );

  const handleSendFeedback = useCallback(() => {
    if (!feedbackMessage.trim()) {
      Alert.alert('Empty Message', 'Please write a message before sending.');
      return;
    }
    Keyboard.dismiss();
    feedbackMutation.mutate({ message: feedbackMessage.trim(), contactEmail: feedbackEmail.trim() || undefined });
  }, [feedbackMessage, feedbackEmail, feedbackMutation]);

  const handleStartClaim = useCallback(() => {
    if (isClaimed) {
      const personStillExists = profile?.rootPersonId ? !!getPerson(profile.rootPersonId) : false;
      if (!personStillExists) {
        Alert.alert(
          'Identity Not Found',
          'Your previously claimed identity could not be found in the current database. This may be due to a data update. Would you like to re-claim?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Re-Claim',
              onPress: async () => {
                await resetClaim();
                setShowClaimSearch(true);
              },
            },
          ]
        );
      } else {
        Alert.alert(
          'Identity Locked',
          `You are permanently linked to "${profile?.rootPersonName}". Your identity can only be changed if there is a database error.`
        );
      }
      return;
    }
    setShowClaimSearch(true);
  }, [isClaimed, profile?.rootPersonId, profile?.rootPersonName, getPerson, resetClaim]);

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          void signOut();
        },
      },
    ]);
  }, [signOut]);

  const handleRefresh = useCallback(() => {
    refreshMutation.mutate();
  }, [refreshMutation]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.avatarSection}>
          <View style={styles.avatarRow}>
            <View style={[styles.avatar, hasClaimed && styles.avatarClaimed]}>
              {hasProfile && profile?.avatarInitials ? (
                <Text style={styles.avatarText}>{profile.avatarInitials}</Text>
              ) : (
                <User size={36} color={Colors.white} />
              )}
            </View>
            <TouchableOpacity
              style={styles.forceRefreshBtn}
              onPress={handleRefresh}
              disabled={refreshMutation.isPending || isLoadingFromCloud}
              activeOpacity={0.6}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              testID="force-refresh-btn"
            >
              {refreshMutation.isPending || isLoadingFromCloud ? (
                <ActivityIndicator size="small" color={Colors.textLight} />
              ) : (
                <RefreshCw size={16} color={Colors.textLight} />
              )}
            </TouchableOpacity>
          </View>
          {hasClaimed && (
            <View style={styles.claimedBadge}>
              <Shield size={12} color={Colors.white} />
              <Text style={styles.claimedBadgeText}>Verified</Text>
            </View>
          )}
          {hasProfile && !isEditing && (
            <>
              <Text style={styles.profileName}>{profile?.displayName}</Text>
              {profile?.rootPersonName && (
                <Text style={styles.profileLinked}>
                  Linked to: {profile.rootPersonName}
                </Text>
              )}
              {profile?.email && (
                <Text style={styles.profileEmail}>{profile.email}</Text>
              )}
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setIsEditing(true)}
              >
                <Text style={styles.editButtonText}>Edit Profile</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {isEditing && (
          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>
              {hasProfile ? 'Edit Profile' : 'Create Your Profile'}
            </Text>
            <Text style={styles.sectionDesc}>
              Set up your profile to track your research and connect with your
              family tree.
            </Text>

            <View style={styles.inputGroup}>
              <View style={styles.inputRow}>
                <User size={18} color={Colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="Display Name"
                  placeholderTextColor={Colors.textLight}
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                  testID="profile-name-input"
                />
              </View>
              <View style={styles.inputDivider} />
              <View style={styles.inputRow}>
                <Mail size={18} color={Colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="Email (optional)"
                  placeholderTextColor={Colors.textLight}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="profile-email-input"
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={isSaving}
            >
              <Check size={18} color={Colors.white} />
              <Text style={styles.saveButtonText}>
                {hasProfile ? 'Save Changes' : 'Create Profile'}
              </Text>
            </TouchableOpacity>

            {hasProfile && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setIsEditing(false);
                  setDisplayName(profile?.displayName ?? '');
                  setEmail(profile?.email ?? '');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {isSignedIn && isEnabled && hasData && (
          <View style={styles.identitySection}>
            <Text style={styles.sectionTitle}>Your Identity</Text>
            {hasClaimed ? (
              <View style={styles.claimedCard}>
                <View style={styles.claimedCardIcon}>
                  <Shield size={20} color={Colors.success} />
                </View>
                <View style={styles.claimedCardContent}>
                  <Text style={styles.claimedCardName}>{profile?.rootPersonName}</Text>
                  <Text style={styles.claimedCardDesc}>
                    Your identity is permanently linked.
                  </Text>
                </View>
                <Lock size={16} color={Colors.textLight} />
              </View>
            ) : showClaimSearch ? (
              <View style={styles.claimSearchContainer}>
                <View style={styles.claimWarning}>
                  <AlertTriangle size={14} color={Colors.danger} />
                  <Text style={styles.claimWarningText}>
                    You can only claim your identity once. Choose carefully.
                  </Text>
                </View>
                <View style={styles.claimSearchBar}>
                  <Search size={18} color={Colors.textLight} />
                  <TextInput
                    style={styles.claimSearchInput}
                    placeholder="Search your name..."
                    placeholderTextColor={Colors.textLight}
                    value={claimQuery}
                    onChangeText={handleClaimSearch}
                    autoCorrect={false}
                    autoFocus
                    testID="claim-search-input"
                  />
                  {claimQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setClaimQuery('');
                        setClaimResults([]);
                      }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <View style={styles.clearBtn}>
                        <X size={12} color={Colors.white} />
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
                {claimResults.length > 0 && (
                  <View style={styles.claimResultsList}>
                    {claimResults.map((person) => (
                      <TouchableOpacity
                        key={person.id}
                        style={styles.claimResultItem}
                        onPress={() => handleClaimPerson(person)}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.claimResultDot,
                            {
                              backgroundColor:
                                person.sex === 'F' ? Colors.female : Colors.male,
                            },
                          ]}
                        />
                        <View style={styles.claimResultInfo}>
                          <Text style={styles.claimResultName} numberOfLines={1}>
                            {person.name}
                          </Text>
                          {person.birthDate && (
                            <Text style={styles.claimResultMeta}>
                              b. {person.birthDate}
                            </Text>
                          )}
                        </View>
                        <ChevronRight size={14} color={Colors.textLight} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {claimQuery.length >= 2 && claimResults.length === 0 && (
                  <Text style={styles.claimNoResults}>No matches found</Text>
                )}
                <TouchableOpacity
                  style={styles.claimCancelBtn}
                  onPress={() => {
                    setShowClaimSearch(false);
                    setClaimQuery('');
                    setClaimResults([]);
                  }}
                >
                  <Text style={styles.claimCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.claimButton}
                onPress={handleStartClaim}
              >
                <User size={18} color={Colors.white} />
                <Text style={styles.claimButtonText}>Claim Your Identity</Text>
              </TouchableOpacity>
            )}
            {!hasClaimed && !showClaimSearch && (
              <Text style={styles.claimHint}>
                Link yourself to a person in the database to use the relationship calculator.
              </Text>
            )}
          </View>
        )}

        <View style={styles.accountSection}>
          <Text style={styles.sectionTitle}>Account</Text>

          {isSignedIn ? (
            <View style={styles.accountCard}>
              <View style={styles.accountHeader}>
                <View style={[styles.accountIcon, isAdmin && styles.accountIconAdmin]}>
                  {isAdmin ? (
                    <ShieldCheck size={18} color={Colors.white} />
                  ) : (
                    <Mail size={18} color={Colors.white} />
                  )}
                </View>
                <View style={styles.accountInfo}>
                  <Text style={styles.accountEmail} numberOfLines={1}>{user?.email ?? 'Signed In'}</Text>
                  <View style={styles.accountBadges}>
                    {isAdmin && (
                      <View style={styles.roleBadge}>
                        <Text style={styles.roleBadgeText}>Admin</Text>
                      </View>
                    )}
                    <View style={[styles.statusBadge, isEnabled ? styles.statusEnabled : styles.statusDisabled]}>
                      <Text style={[styles.statusBadgeText, isEnabled ? styles.statusTextEnabled : styles.statusTextDisabled]}>
                        {isEnabled ? 'Enabled' : 'Pending Approval'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {isAdmin && (
                <>
                  <TouchableOpacity
                    style={styles.pendingEditsBtn}
                    onPress={() => router.push('/pending-edits')}
                    activeOpacity={0.7}
                  >
                    <ClipboardList size={16} color={Colors.accent} />
                    <Text style={styles.pendingEditsBtnText}>Review Pending Edits</Text>
                    {pendingEditCount > 0 && (
                      <View style={styles.pendingBadge}>
                        <Text style={styles.pendingBadgeText}>{pendingEditCount}</Text>
                      </View>
                    )}
                    <ChevronRight size={14} color={Colors.textLight} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.pendingEditsBtn}
                    onPress={() => router.push('/admin')}
                    activeOpacity={0.7}
                  >
                    <Users size={16} color={Colors.accent} />
                    <Text style={styles.pendingEditsBtnText}>Manage Users</Text>
                    <ChevronRight size={14} color={Colors.textLight} />
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                style={styles.logoutBtn}
                onPress={handleSignOut}
                disabled={signOutPending}
                activeOpacity={0.7}
              >
                {signOutPending ? (
                  <ActivityIndicator size="small" color={Colors.danger} />
                ) : (
                  <LogOut size={16} color={Colors.danger} />
                )}
                <Text style={styles.logoutBtnText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.signInPromptCard}>
              <Text style={styles.signInPromptText}>
                Sign in to access cloud features, submit edits, and manage your account.
              </Text>
              <TouchableOpacity
                style={styles.signInBtn}
                onPress={() => router.push('/auth')}
                activeOpacity={0.7}
              >
                <LogIn size={16} color={Colors.white} />
                <Text style={styles.signInBtnText}>Sign In</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {isSignedIn && isEnabled && hasData && (
          <View style={styles.databaseSection}>
            <Text style={styles.sectionTitle}>Database</Text>

            {cloudError && (
              <View style={styles.cloudErrorBanner}>
                <AlertTriangle size={14} color={Colors.danger} />
                <Text style={styles.cloudErrorText} numberOfLines={2}>{cloudError}</Text>
              </View>
            )}

            <View style={styles.dbCard}>
              <View style={styles.dataStats}>
                <View style={styles.dataStat}>
                  <Text style={styles.dataStatNumber}>{individualCount}</Text>
                  <Text style={styles.dataStatLabel}>People</Text>
                </View>
                <View style={styles.dataStatDivider} />
                <View style={styles.dataStat}>
                  <Text style={styles.dataStatNumber}>{familyCount}</Text>
                  <Text style={styles.dataStatLabel}>Families</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.refreshRow}
                onPress={handleRefresh}
                disabled={refreshMutation.isPending || isLoadingFromCloud}
                activeOpacity={0.7}
              >
                {refreshMutation.isPending || isLoadingFromCloud ? (
                  <ActivityIndicator size="small" color={Colors.accent} />
                ) : (
                  <RefreshCw size={16} color={Colors.accent} />
                )}
                <Text style={styles.refreshRowText}>
                  {refreshMutation.isPending || isLoadingFromCloud
                    ? loadProgress
                      ? loadProgress.phase === 'individuals'
                        ? `Loading people... (${loadProgress.individualsLoaded})`
                        : loadProgress.phase === 'families'
                          ? `Loading families... (${loadProgress.familiesLoaded})`
                          : loadProgress.phase === 'members'
                            ? `Loading connections... (${loadProgress.membersLoaded})`
                            : loadProgress.phase === 'assembling'
                              ? 'Assembling tree...'
                              : 'Refreshing...'
                      : 'Refreshing...'
                    : 'Refresh from Database'}
                </Text>
                <ChevronRight size={14} color={Colors.textLight} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {isSignedIn && <View style={styles.feedbackSection}>
          <Text style={styles.sectionTitle}>Feedback</Text>
          <Text style={styles.feedbackDesc}>Have a suggestion or found a bug? Let us know!</Text>
          {feedbackSent && (
            <View style={styles.feedbackSuccess}>
              <Check size={14} color={Colors.success} />
              <Text style={styles.feedbackSuccessText}>Feedback sent successfully! Thank you.</Text>
            </View>
          )}
          <View style={styles.feedbackCard}>
            <View style={styles.feedbackInputWrap}>
              <MessageSquare size={16} color={Colors.textLight} style={{ marginTop: 2 }} />
              <TextInput
                style={styles.feedbackInput}
                placeholder="Write your feedback..."
                placeholderTextColor={Colors.textLight}
                value={feedbackMessage}
                onChangeText={setFeedbackMessage}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                testID="feedback-input"
              />
            </View>
            <View style={styles.feedbackEmailWrap}>
              <Mail size={14} color={Colors.textLight} />
              <TextInput
                style={styles.feedbackEmailInput}
                placeholder="Contact email (optional)"
                placeholderTextColor={Colors.textLight}
                value={feedbackEmail}
                onChangeText={setFeedbackEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                testID="feedback-email-input"
              />
            </View>
            <TouchableOpacity
              style={[styles.feedbackSendButton, (!feedbackMessage.trim() || feedbackMutation.isPending) && styles.feedbackSendDisabled]}
              onPress={handleSendFeedback}
              disabled={feedbackMutation.isPending || !feedbackMessage.trim()}
              activeOpacity={0.7}
            >
              <Send size={16} color={Colors.white} />
              <Text style={styles.feedbackSendText}>{feedbackMutation.isPending ? 'Sending...' : 'Send Feedback'}</Text>
            </TouchableOpacity>
          </View>
        </View>}

        <View style={styles.legalSection}>
          <Text style={styles.sectionTitle}>Legal</Text>
          <View style={styles.dataCard}>
            <TouchableOpacity
              style={styles.dataAction}
              onPress={() => router.push('/privacy-policy')}
              activeOpacity={0.7}
            >
              <FileText size={16} color={Colors.accent} />
              <Text style={styles.dataActionText}>Privacy Policy</Text>
              <ChevronRight size={16} color={Colors.textLight} />
            </TouchableOpacity>
          </View>
        </View>

        {isSignedIn && isEnabled && (
          <View style={styles.dataSection}>
            <Text style={styles.sectionTitle}>Family Data</Text>

            {hasData ? (
              <View style={styles.dataCard}>
                <TouchableOpacity
                  style={styles.dataAction}
                  onPress={handleImport}
                >
                  <Database size={16} color={Colors.accent} />
                  <Text style={styles.dataActionText}>Import New Data</Text>
                  <ChevronRight size={16} color={Colors.textLight} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dangerAction}
                  onPress={handleClearData}
                >
                  <Trash2 size={16} color={Colors.danger} />
                  <Text style={styles.dangerActionText}>Clear Local Cache</Text>
                  <ChevronRight size={16} color={Colors.textLight} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.importCard} onPress={handleImport}>
                <TreePine size={28} color={Colors.accent} />
                <Text style={styles.importTitle}>Import GEDCOM File</Text>
                <Text style={styles.importDesc}>
                  Load your family tree data to start exploring
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  avatarSection: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 20,
  },
  avatarRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  forceRefreshBtn: {
    position: 'absolute' as const,
    right: 20,
    top: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarClaimed: {
    borderWidth: 3,
    borderColor: Colors.success,
  },
  avatarText: {
    color: Colors.white,
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: 1,
  },
  claimedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
    marginBottom: 8,
    marginTop: -8,
  },
  claimedBadgeText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  profileLinked: {
    fontSize: 13,
    color: Colors.success,
    marginTop: 4,
    fontWeight: '500' as const,
  },
  profileEmail: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  editButton: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.overlay,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.accent,
  },
  formSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  sectionDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    paddingHorizontal: 16,
    marginBottom: 16,
    lineHeight: 20,
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
    height: 50,
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
    height: 50,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 50,
    marginTop: 16,
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  cancelButtonText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  identitySection: {
    paddingTop: 24,
  },
  claimedCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.success,
    marginTop: 8,
    gap: 14,
    alignItems: 'center',
  },
  claimedCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(74, 124, 89, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  claimedCardContent: {
    flex: 1,
  },
  claimedCardName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  claimedCardDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  claimSearchContainer: {
    marginHorizontal: 16,
    marginTop: 8,
  },
  claimWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(196, 92, 74, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
    marginBottom: 10,
  },
  claimWarningText: {
    flex: 1,
    fontSize: 12,
    color: Colors.danger,
    fontWeight: '500' as const,
    lineHeight: 17,
  },
  claimSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.searchBar,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  claimSearchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    marginLeft: 10,
    height: 44,
  },
  clearBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.textLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  claimResultsList: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginTop: 8,
    overflow: 'hidden',
    maxHeight: 260,
  },
  claimResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    gap: 10,
  },
  claimResultDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  claimResultInfo: {
    flex: 1,
  },
  claimResultName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  claimResultMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  claimNoResults: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
  },
  claimCancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  claimCancelText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  claimButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    marginHorizontal: 16,
    borderRadius: 14,
    height: 50,
    gap: 8,
    marginTop: 8,
  },
  claimButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600' as const,
  },
  claimHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 32,
    lineHeight: 18,
  },
  accountSection: {
    paddingTop: 24,
  },
  accountCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  accountIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountIconAdmin: {
    backgroundColor: Colors.success,
  },
  accountInfo: {
    flex: 1,
  },
  accountEmail: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  accountBadges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  roleBadge: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.white,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusEnabled: {
    backgroundColor: 'rgba(74, 124, 89, 0.12)',
  },
  statusDisabled: {
    backgroundColor: 'rgba(196, 92, 74, 0.1)',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600' as const,
  },
  statusTextEnabled: {
    color: Colors.success,
  },
  statusTextDisabled: {
    color: Colors.danger,
  },
  pendingEditsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    gap: 10,
  },
  pendingEditsBtnText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  pendingBadge: {
    backgroundColor: Colors.danger,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  pendingBadgeText: {
    color: Colors.white,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    gap: 10,
  },
  logoutBtnText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.danger,
  },
  signInPromptCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 16,
  },
  signInPromptText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: 14,
  },
  signInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    gap: 8,
  },
  signInBtnText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600' as const,
  },
  databaseSection: {
    paddingTop: 24,
  },
  cloudErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(196, 92, 74, 0.08)',
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
    marginBottom: 10,
  },
  cloudErrorText: {
    flex: 1,
    fontSize: 12,
    color: Colors.danger,
    fontWeight: '500' as const,
    lineHeight: 17,
  },
  dbCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  dataStats: {
    flexDirection: 'row',
    padding: 20,
  },
  dataStat: {
    flex: 1,
    alignItems: 'center',
  },
  dataStatNumber: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.accent,
  },
  dataStatLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  dataStatDivider: {
    width: 1,
    backgroundColor: Colors.divider,
  },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    gap: 10,
  },
  refreshRowText: {
    flex: 1,
    fontSize: 14,
    color: Colors.accent,
    fontWeight: '500' as const,
  },
  feedbackSection: {
    paddingTop: 24,
  },
  feedbackDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    paddingHorizontal: 16,
    marginBottom: 10,
    lineHeight: 18,
  },
  feedbackCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  feedbackInputWrap: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 10,
  },
  feedbackInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    minHeight: 80,
    maxHeight: 140,
  },
  feedbackSendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
    marginHorizontal: 12,
    marginBottom: 12,
    paddingVertical: 11,
    borderRadius: 10,
    gap: 8,
  },
  feedbackSendDisabled: {
    opacity: 0.5,
  },
  feedbackSendText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  feedbackEmailWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    paddingTop: 10,
  },
  feedbackEmailInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    height: 36,
  },
  feedbackSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(74, 124, 89, 0.1)',
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
    marginBottom: 8,
  },
  feedbackSuccessText: {
    fontSize: 13,
    color: Colors.success,
    fontWeight: '500' as const,
  },
  dataSection: {
    paddingTop: 24,
  },
  dataCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
    marginTop: 8,
  },
  dataAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  dataActionText: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  dangerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    gap: 10,
  },
  dangerActionText: {
    flex: 1,
    fontSize: 15,
    color: Colors.danger,
    fontWeight: '500' as const,
  },
  importCard: {
    backgroundColor: Colors.card,
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderStyle: 'dashed',
    marginTop: 8,
  },
  importTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 12,
  },
  importDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  legalSection: {
    paddingTop: 24,
  },
});
