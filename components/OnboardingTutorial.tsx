import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, GitFork, Clock, User, ArrowRight, TreePine, ChevronRight, UserPlus, Heart, Shield, Edit3, MessageSquare, ShieldCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface TutorialStep {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: string;
}

const STEPS: TutorialStep[] = [
  {
    icon: <TreePine size={36} color={Colors.accent} />,
    title: 'Welcome to Your Family Tree',
    description:
      'Explore your genealogy data, discover ancestors, and uncover the connections between family members across generations.',
    accent: Colors.accent,
  },
  {
    icon: <Search size={36} color={Colors.male} />,
    title: 'Search & Explore',
    description:
      'Use the Search tab to find anyone in your family tree. Tap a person to view their details, family connections, notes, and expandable tree view. Use the Home button to jump back quickly.',
    accent: Colors.male,
  },
  {
    icon: <GitFork size={36} color={Colors.success} />,
    title: 'Calculate Relationships',
    description:
      'The Relations tab lets you pick any two people and discover every path that connects them. Once you claim your identity, search results will also show how each person is related to you.',
    accent: Colors.success,
  },
  {
    icon: <Shield size={36} color={Colors.female} />,
    title: 'Claim Your Identity',
    description:
      'In the Profile tab, link yourself to a person in the database. This is a one-time setup — choose carefully! It powers auto-fill in relationship searches and shows your relation to others.',
    accent: Colors.female,
  },
  {
    icon: <UserPlus size={36} color={'#5B8FA8'} />,
    title: 'Add Children & Spouses',
    description:
      'From any person\'s detail page, you can add children or spouses. You can also create new marriage relationships between people already in the database.',
    accent: '#5B8FA8',
  },
  {
    icon: <Edit3 size={36} color={'#C49A6C'} />,
    title: 'Edit People & Marriages',
    description:
      'Tap the edit button on any person to update their name, dates, and notes. Marriage details like date and place can also be edited from the family view.',
    accent: '#C49A6C',
  },
  {
    icon: <ShieldCheck size={36} color={'#7A9E7E'} />,
    title: 'Admin & Approvals',
    description:
      'Non-admin edits are submitted for review. Admins can approve or reject changes from the Profile tab. Use the Feedback section to report bugs or suggest features.',
    accent: '#7A9E7E',
  },
];

interface OnboardingTutorialProps {
  onComplete: () => void;
}

export default function OnboardingTutorial({ onComplete }: OnboardingTutorialProps) {
  const insets = useSafeAreaInsets();
  const [currentStep, setCurrentStep] = useState<number>(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(bgOpacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [bgOpacity]);

  const animateToStep = useCallback(
    (nextStep: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: -30, duration: 150, useNativeDriver: true }),
      ]).start(() => {
        setCurrentStep(nextStep);
        slideAnim.setValue(30);
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start();
      });
    },
    [fadeAnim, slideAnim]
  );

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      animateToStep(currentStep + 1);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.timing(bgOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        onComplete();
      });
    }
  }, [currentStep, animateToStep, bgOpacity, onComplete]);

  const handleSkip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(bgOpacity, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      onComplete();
    });
  }, [bgOpacity, onComplete]);

  const step = STEPS[currentStep];
  const isLast = currentStep === STEPS.length - 1;

  return (
    <Animated.View style={[styles.overlay, { opacity: bgOpacity }]}>
      <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.topRow}>
          {!isLast ? (
            <TouchableOpacity onPress={handleSkip} style={styles.skipButton} activeOpacity={0.7}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
        </View>

        <View style={styles.content}>
          <Animated.View
            style={[
              styles.stepContent,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <View style={[styles.iconCircle, { borderColor: step.accent + '30' }]}>
              <View style={[styles.iconInner, { backgroundColor: step.accent + '12' }]}>
                {step.icon}
              </View>
            </View>

            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.description}>{step.description}</Text>
          </Animated.View>
        </View>

        <View style={styles.bottomSection}>
          <View style={styles.dotsRow}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === currentStep && [styles.dotActive, { backgroundColor: step.accent }],
                ]}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.nextButton, { backgroundColor: step.accent }]}
            onPress={handleNext}
            activeOpacity={0.8}
          >
            <Text style={styles.nextButtonText}>
              {isLast ? "Let's Go" : 'Next'}
            </Text>
            {!isLast && <ChevronRight size={18} color={Colors.white} />}
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26, 24, 22, 0.92)',
    zIndex: 1000,
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 20,
  },
  skipButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  skipText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.6)',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepContent: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  iconInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: '800' as const,
    color: Colors.white,
    textAlign: 'center',
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  description: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 300,
  },
  bottomSection: {
    alignItems: 'center',
    gap: 24,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  dotActive: {
    width: 24,
    borderRadius: 4,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 6,
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.white,
  },
});
