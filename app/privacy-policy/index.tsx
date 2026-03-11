import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Stack } from 'expo-router';
import { Shield } from 'lucide-react-native';
import Colors from '@/constants/colors';

const LAST_UPDATED = 'March 11, 2026';

export default function PrivacyPolicyScreen() {
  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Privacy Policy',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.text,
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Shield size={28} color={Colors.accent} />
          </View>
          <Text style={styles.title}>Privacy Policy</Text>
          <Text style={styles.lastUpdated}>Last updated: {LAST_UPDATED}</Text>
        </View>

        <Section title="Introduction">
          This Privacy Policy describes how the Family Tree App ("we", "us", or "our")
          collects, uses, and protects your information when you use our mobile application.
          By using the app, you agree to the practices described in this policy.
        </Section>

        <Section title="Information We Collect">
          <BulletPoint text="Account Information: When you create an account, we collect your email address and password. Passwords are securely hashed and never stored in plain text." />
          <BulletPoint text="Profile Information: You may optionally provide a display name and link your identity to a person in the family tree database." />
          <BulletPoint text="Family Tree Data: The app accesses shared genealogical data (names, dates, places, and family relationships) stored in our database. This data is managed by the administrator." />
          <BulletPoint text="Usage Data: We store your search history and relationship calculations locally on your device to improve your experience." />
          <BulletPoint text="Feedback: If you submit feedback through the app, we collect the message content and your display name." />
        </Section>

        <Section title="How We Use Your Information">
          <BulletPoint text="To provide access to the family tree database and relationship calculator." />
          <BulletPoint text="To authenticate your identity and manage account access." />
          <BulletPoint text="To allow administrators to review and approve user access." />
          <BulletPoint text="To process and display your submitted edits and feedback." />
          <BulletPoint text="To cache data locally for faster load times and offline browsing." />
        </Section>

        <Section title="Data Storage & Security">
          Your account data is stored securely using Supabase, which provides
          enterprise-grade security including encrypted data transmission (TLS),
          encrypted data at rest, and row-level security policies that restrict
          data access to authorized users only. Local data (profile, search history,
          cached tree data) is stored on your device using secure storage mechanisms.
        </Section>

        <Section title="Access Control">
          New accounts require administrator approval before accessing family tree data.
          This ensures that only authorized individuals can view sensitive genealogical
          information. Administrators can enable, disable, or grant admin privileges
          to user accounts.
        </Section>

        <Section title="Data Sharing" intro="We do not sell, trade, or rent your personal information to third parties. Your data is only shared with:">
          <BulletPoint text="Other approved users of the app who can view the shared family tree data." />
          <BulletPoint text="Supabase (our database provider) for secure data storage and authentication." />
          <BulletPoint text="No analytics services, advertising networks, or other third parties receive your data." />
        </Section>

        <Section title="Your Rights">
          <BulletPoint text="Access: You can view all personal data associated with your account within the app." />
          <BulletPoint text="Correction: You can update your profile information at any time." />
          <BulletPoint text="Deletion: You may request account deletion by contacting the administrator. Upon deletion, your account data and profile will be permanently removed." />
          <BulletPoint text="Data Export: You may request an export of your personal data by contacting the administrator." />
        </Section>

        <Section title="Data Retention">
          We retain your account information for as long as your account is active.
          Locally cached data can be cleared at any time from the Profile tab.
          If your account is deleted, all associated data is permanently removed
          from our servers.
        </Section>

        <Section title="Children's Privacy">
          This app is not intended for use by children under 13 years of age.
          We do not knowingly collect personal information from children under 13.
          If you believe a child has provided us with personal data, please contact
          the administrator so we can remove it.
        </Section>

        <Section title="Changes to This Policy">
          We may update this Privacy Policy from time to time. Any changes will be
          reflected with an updated "Last updated" date at the top of this page.
          Continued use of the app after changes constitutes acceptance of the
          revised policy.
        </Section>

        <Section title="Contact">
          If you have any questions about this Privacy Policy or wish to exercise
          your data rights, please contact the administrator through the in-app
          feedback form on the Profile tab.
        </Section>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Family Tree App</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {typeof children === 'string' ? (
        <Text style={styles.sectionBody}>{children}</Text>
      ) : (
        <View>
          {intro ? <Text style={[styles.sectionBody, { marginBottom: 10 }]}>{intro}</Text> : null}
          {children}
        </View>
      )}
    </View>
  );
}

function BulletPoint({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bullet} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
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
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(200, 149, 108, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  lastUpdated: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingRight: 8,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
    marginTop: 8,
    marginRight: 10,
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 12,
  },
  footerText: {
    fontSize: 12,
    color: Colors.textLight,
  },
});
