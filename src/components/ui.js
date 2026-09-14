// Mảnh giao diện dùng lại nhiều nơi. Không chứa logic nghiệp vụ.

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors, mono } from '../theme.js';

export function Screen({ children, refreshControl }) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ title, subtitle, children, style }) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

// busyTitle: nhãn hiện cạnh spinner lúc đang chạy. Dùng cho việc chạy lâu mà
// không báo được tiến độ — người bấm cần biết máy đang làm gì, không phải chết.
export function Button({ title, busyTitle, onPress, disabled, busy, tone = 'primary', style }) {
  const toneStyle =
    tone === 'ghost' ? styles.btnGhost : tone === 'danger' ? styles.btnDanger : styles.btnPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.btn,
        toneStyle,
        (disabled || busy) && styles.btnDisabled,
        pressed && styles.btnPressed,
        style,
      ]}
    >
      {busy ? (
        <View style={styles.btnBusy}>
          <ActivityIndicator color={tone === 'ghost' ? colors.text : '#fff'} size="small" />
          {busyTitle ? (
            <Text style={[styles.btnText, tone === 'ghost' && styles.btnGhostText]}>
              {busyTitle}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={[styles.btnText, tone === 'ghost' && styles.btnGhostText]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input({ label, hint, monospace, style, ...props }) {
  return (
    <View style={styles.inputWrap}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={[styles.input, monospace && styles.inputMono, style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

// Dòng hiện một giá trị dài kèm nút copy.
export function CopyRow({ label, value, secret, badge }) {
  const [revealed, setRevealed] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Không có chỗ hiện banner ở dòng này, nên báo ngay trên chính nhãn nút.
      setFailed(true);
      setTimeout(() => setFailed(false), 1200);
    }
  };

  return (
    <View style={styles.copyRow}>
      <View style={styles.copyHeader}>
        <Text style={styles.copyLabel}>{label}</Text>
        {badge ? <Text style={styles.copyBadge}>{badge}</Text> : null}
        <View style={styles.spacer} />
        {secret ? (
          <Pressable onPress={() => setRevealed((v) => !v)} hitSlop={8}>
            <Text style={styles.copyAction}>{revealed ? 'Ẩn' : 'Hiện'}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={copy} hitSlop={8}>
          <Text style={[styles.copyAction, failed && { color: colors.danger }]}>
            {failed ? 'Lỗi' : copied ? 'Đã chép' : 'Chép'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.copyValue} selectable numberOfLines={3}>
        {revealed ? value : '•'.repeat(Math.min(value.length, 44))}
      </Text>
    </View>
  );
}

export function Banner({ tone = 'info', title, children }) {
  const toneColor =
    tone === 'error' ? colors.danger : tone === 'ok' ? colors.ok : tone === 'warn' ? colors.warn : colors.accent;
  // JSX gộp nhiều dòng chữ, hoặc chữ xen {biến}, thành MẢNG chứ không phải một
  // chuỗi. Kiểm `typeof children === 'string'` sẽ trượt những trường hợp đó và
  // thả chuỗi trần vào <View> — RN ném "Text strings must be rendered within a
  // <Text> component". Nên phải soi từng phần tử con.
  const hasBareText = React.Children.toArray(children).some(
    (child) => typeof child === 'string' || typeof child === 'number'
  );
  return (
    <View style={[styles.banner, { borderColor: toneColor, backgroundColor: toneColor + '18' }]}>
      {title ? <Text style={[styles.bannerTitle, { color: toneColor }]}>{title}</Text> : null}
      {hasBareText ? <Text style={styles.bannerText}>{children}</Text> : children}
    </View>
  );
}

export function StatRow({ label, value, valueColor }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

export function Mono({ children, style }) {
  return <Text style={[styles.mono, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: 16, paddingBottom: 48, gap: 14 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: colors.dim, fontSize: 13, lineHeight: 19, marginTop: -4 },
  btn: { borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.accent },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  btnDanger: { backgroundColor: colors.danger },
  btnDisabled: { opacity: 0.4 },
  btnPressed: { opacity: 0.8 },
  btnBusy: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnGhostText: { color: colors.text },
  inputWrap: { gap: 6 },
  inputLabel: { color: colors.dim, fontSize: 13, fontWeight: '600' },
  input: {
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 15,
  },
  inputMono: { fontFamily: mono, fontSize: 12.5 },
  hint: { color: colors.faint, fontSize: 12, lineHeight: 17 },
  copyRow: { gap: 4 },
  copyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copyLabel: { color: colors.dim, fontSize: 13, fontWeight: '600' },
  copyBadge: {
    color: colors.faint,
    fontSize: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  spacer: { flex: 1 },
  copyAction: { color: colors.accent, fontSize: 12.5, fontWeight: '600' },
  copyValue: { color: colors.text, fontFamily: mono, fontSize: 12, lineHeight: 17 },
  banner: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
  bannerTitle: { fontSize: 14, fontWeight: '700' },
  bannerText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  statLabel: { color: colors.dim, fontSize: 13.5 },
  statValue: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  mono: { fontFamily: mono, color: colors.text, fontSize: 12 },
});
