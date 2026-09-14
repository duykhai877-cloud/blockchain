// Huy hiệu loại ví: S màu cam, E màu tím.
//
// Màu và chữ cái lấy từ REGISTRY trong algorithms.js chứ không viết cứng ở đây —
// thêm thuật toán thứ ba thì huy hiệu tự có màu mà không phải sửa component.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getAlgorithm } from '../crypto/algorithms.js';

export default function WalletTypeBadge({ algorithmId, size = 'md', showName = false }) {
  const algorithm = getAlgorithm(algorithmId);
  if (!algorithm) return null;

  const small = size === 'sm';
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.badge,
          small && styles.badgeSm,
          { backgroundColor: algorithm.color + '26', borderColor: algorithm.color },
        ]}
      >
        <Text style={[styles.letter, small && styles.letterSm, { color: algorithm.color }]}>
          {algorithm.letter}
        </Text>
      </View>
      {showName ? <Text style={[styles.name, { color: algorithm.color }]}>{algorithm.name}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeSm: { width: 20, height: 20, borderRadius: 5 },
  letter: { fontSize: 14, fontWeight: '700' },
  letterSm: { fontSize: 11 },
  name: { fontSize: 12, fontWeight: '600' },
});
