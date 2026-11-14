import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useColors, type ColorPalette } from '@/contexts/ThemeContext';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const Colors = useColors();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.button} onPress={onAction}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function createStyles(Colors: ColorPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
    },
    iconContainer: {
      marginBottom: 16,
      opacity: 0.6,
    },
    title: {
      fontSize: 18,
      fontWeight: '600' as const,
      color: Colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    description: {
      fontSize: 14,
      color: Colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    button: {
      marginTop: 20,
      backgroundColor: Colors.accent,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 24,
    },
    buttonText: {
      color: Colors.white,
      fontSize: 14,
      fontWeight: '600' as const,
    },
  });
}
