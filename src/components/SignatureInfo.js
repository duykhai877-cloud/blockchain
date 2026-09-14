// Bảng kết quả sau khi ký.
//
// Dòng đối chiếu cuối bảng là bắt buộc: người dùng chỉ có MỘT loại ví nên tự
// thân không bao giờ nhìn thấy được so sánh giữa hai thuật toán. Con số ở dòng
// đó được TÍNH RA từ chính giao dịch vừa ký (thay public key và chữ ký bằng độ
// dài của thuật toán kia rồi đo lại), không phải số viết cứng.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, mono } from '../theme.js';
import { getAlgorithm, listAlgorithms } from '../crypto/algorithms.js';
import { utf8ToBytes } from '../crypto/bytes.js';

function byteLength(text) {
  return utf8ToBytes(text).length;
}

function serializeWhole(tx) {
  return JSON.stringify({
    type: tx.type,
    from: tx.from,
    fromAddr: tx.fromAddr,
    to: tx.to,
    amount: tx.amount,
    timestamp: tx.timestamp,
    nonce: tx.nonce,
    sigAlg: tx.sigAlg,
    signature: tx.signature,
  });
}

// Cùng giao dịch này sẽ nặng bao nhiêu nếu ký bằng thuật toán kia.
function counterfactualSize(tx, otherAlgorithm) {
  const fake = {
    ...tx,
    from: 'a'.repeat(otherAlgorithm.publicKeyHexLen),
    fromAddr: otherAlgorithm.prefix + tx.fromAddr.slice(3),
    sigAlg: otherAlgorithm.id,
    signature: 'a'.repeat(otherAlgorithm.typicalSignatureBytes * 2),
  };
  return { signatureBytes: otherAlgorithm.typicalSignatureBytes, totalBytes: byteLength(serializeWhole(fake)) };
}

function Row({ label, value, valueStyle }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, valueStyle]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export default function SignatureInfo({ tx, signingMs }) {
  const algorithm = getAlgorithm(tx.sigAlg);
  if (!algorithm) return null;

  const signatureBytes = tx.signature.length / 2;
  const totalBytes = byteLength(serializeWhole(tx));
  const other = listAlgorithms().find((a) => a.id !== algorithm.id);
  const compare = other ? counterfactualSize(tx, other) : null;

  return (
    <View style={styles.card}>
      <Text style={[styles.title, { color: algorithm.color }]}>
        Đã ký bằng {algorithm.fullName}
      </Text>

      <Row label="Chữ ký" value={`${tx.signature.slice(0, 24)}…`} valueStyle={styles.monoValue} />
      <Row label="Định dạng" value={`${algorithm.signatureFormat} · ${signatureBytes} byte`} />
      <Row label="Thời gian ký" value={`${signingMs.toFixed(1)} ms`} />
      <Row
        label="Public key"
        value={`${algorithm.publicKeyBytes} byte (${algorithm.publicKeyNote})`}
      />
      <Row label="Tổng tx" value={`${totalBytes} byte`} />

      {compare ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.compare}>
            Cùng giao dịch này nếu ví loại{' '}
            <Text style={{ color: other.color, fontWeight: '700' }}>{other.letter}</Text>:{' '}
            {compare.signatureBytes} byte · {compare.totalBytes} byte
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 2,
  },
  title: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 3 },
  label: { width: 108, color: colors.dim, fontSize: 13 },
  value: { flex: 1, color: colors.text, fontSize: 13 },
  monoValue: { fontFamily: mono, fontSize: 12 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  compare: { color: colors.dim, fontSize: 13, lineHeight: 19 },
});
