// Thanh trượt "Trượt để Xác nhận" — tự viết bằng PanResponder.
//
// Không dùng thư viện slider: ràng buộc dự án cấm, và bản thân cử chỉ này chỉ
// cần một Animated.Value cùng bốn callback của PanResponder.
//
// Ý nghĩa: ký một giao dịch là hành động không hoàn tác được, nên cần một cử chỉ
// có chủ đích chứ không phải một cú chạm dễ bấm nhầm.

import React, { useRef, useState, useEffect } from 'react';
import { View, Text, Animated, PanResponder, StyleSheet } from 'react-native';
import { colors } from '../theme.js';

const KNOB = 54;
const TRACK_HEIGHT = 62;
// Trượt qua 85% chiều dài là tính như đã xác nhận — người dùng không phải đẩy
// sát mép, thao tác đó khó trên màn hình cong.
const CONFIRM_RATIO = 0.85;

export default function SlideToSign({ label = 'Trượt để Xác nhận', disabled, busy, onConfirm, resetKey }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const maxSlide = Math.max(trackWidth - KNOB - 8, 1);

  // Giá trị mới nhất mà PanResponder cần đọc. PanResponder được tạo một lần nên
  // không nhìn thấy state mới nếu đọc trực tiếp từ closure.
  const state = useRef({ maxSlide, disabled, busy, onConfirm });
  state.current = { maxSlide, disabled, busy, onConfirm };

  const springBack = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
  };

  useEffect(() => {
    springBack();
  }, [resetKey]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !state.current.disabled && !state.current.busy,
      onMoveShouldSetPanResponder: () => !state.current.disabled && !state.current.busy,
      onPanResponderMove: (_event, gesture) => {
        if (state.current.disabled || state.current.busy) return;
        const next = Math.min(Math.max(gesture.dx, 0), state.current.maxSlide);
        translateX.setValue(next);
      },
      onPanResponderRelease: (_event, gesture) => {
        if (state.current.disabled || state.current.busy) return;
        const travelled = Math.min(Math.max(gesture.dx, 0), state.current.maxSlide);
        if (travelled >= state.current.maxSlide * CONFIRM_RATIO) {
          Animated.timing(translateX, {
            toValue: state.current.maxSlide,
            duration: 90,
            useNativeDriver: true,
          }).start(() => {
            state.current.onConfirm && state.current.onConfirm();
          });
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: springBack,
    })
  ).current;

  const fillOpacity = translateX.interpolate({
    inputRange: [0, Math.max(maxSlide, 1)],
    outputRange: [0.15, 0.55],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={[styles.track, disabled && styles.trackDisabled]}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View style={[styles.fill, { opacity: fillOpacity }]} />
      <Text style={[styles.label, disabled && styles.labelDisabled]} numberOfLines={1}>
        {busy ? 'Đang ký…' : label}
      </Text>
      <Animated.View
        style={[styles.knob, disabled && styles.knobDisabled, { transform: [{ translateX }] }]}
        {...responder.panHandlers}
      >
        <Text style={styles.knobText}>{busy ? '•••' : '›››'}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackDisabled: { opacity: 0.45 },
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.accent },
  label: {
    textAlign: 'center',
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    paddingLeft: KNOB / 2,
  },
  knob: {
    position: 'absolute',
    left: 4,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobDisabled: { backgroundColor: colors.faint },
  knobText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
