import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  type ScrollView,
  type View,
} from 'react-native';

/**
 * Android edge-to-edge ignores window resize, and auth is presented as a modal
 * that the keyboard draws over. Pad the scroll view and move the focused field
 * above the keyboard instead of relying on KeyboardAvoidingView.
 */
export function useAndroidKeyboardScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const keyboardHeightRef = useRef(0);
  const focusedKey = useRef<string | null>(null);
  const fieldRefs = useRef<Record<string, View | null>>({});
  const [keyboardPadding, setKeyboardPadding] = useState(0);

  const reveal = useCallback((key: string | null, kb: number) => {
    if (Platform.OS !== 'android' || !key || kb <= 0) return;
    const field = fieldRefs.current[key];
    if (!field) return;

    field.measureInWindow((_x, y, _w, height) => {
      const visibleBottom = Dimensions.get('window').height - kb - 12;
      const overlap = y + height + 16 - visibleBottom;
      if (overlap > 8) {
        scrollRef.current?.scrollTo({
          y: scrollY.current + overlap,
          animated: true,
        });
      }
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      const kb = e.endCoordinates.height;
      keyboardHeightRef.current = kb;
      setKeyboardPadding(kb);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardHeightRef.current = 0;
      setKeyboardPadding(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardPadding <= 0) return;
    const timer = setTimeout(() => {
      reveal(focusedKey.current, keyboardPadding);
    }, 60);
    return () => clearTimeout(timer);
  }, [keyboardPadding, reveal]);

  const onScrollOffset = useCallback((y: number) => {
    scrollY.current = y;
  }, []);

  const fieldProps = useCallback((key: string) => ({
    ref: (node: View | null) => {
      fieldRefs.current[key] = node;
    },
    onFocus: () => {
      focusedKey.current = key;
      // Keyboard height may still be 0 until keyboardDidShow; the effect
      // reveals again once padding is applied.
      const estimated = keyboardHeightRef.current || Math.round(Dimensions.get('window').height * 0.4);
      reveal(key, estimated);
    },
  }), [reveal]);

  return {
    scrollRef,
    keyboardPadding: Platform.OS === 'android' ? keyboardPadding : 0,
    onScrollOffset,
    fieldProps,
  };
}
