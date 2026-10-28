import React, { useCallback } from 'react';
import { TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { navigateBack } from '@/utils/navigation';

/** Reliable close control for modal slides (dismiss-first navigation). */
export default function ModalCloseButton() {
  const router = useRouter();

  const onPress = useCallback(() => {
    navigateBack(router);
  }, [router]);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.btn}
      hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
      accessibilityRole="button"
      accessibilityLabel="Close"
      testID="modal-close"
    >
      <X size={22} color={Colors.text} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginLeft: Platform.OS === 'ios' ? -4 : 0,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 40,
    minHeight: 40,
  },
});
