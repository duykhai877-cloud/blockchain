// Màn chuyển coin.
//
// Ô "public key của chính mình" nhập tay là YÊU CẦU CÓ CHỦ Ý, dù app hoàn toàn tự
// điền được. Mục đích: demo trực quan Luật 2 và Luật 3 từ chối khi nhập sai.
// KHÔNG được tự động điền sẵn.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Screen, Card, Button, Input, Banner, Mono } from '../components/ui.js';
import WalletTypeBadge from '../components/WalletTypeBadge.js';
import SlideToSign from '../components/SlideToSign.js';
import SignatureInfo from '../components/SignatureInfo.js';
import { colors, mono } from '../theme.js';
import { getAlgorithm } from '../crypto/algorithms.js';
import { parseAddress, tryDeriveAddress, ADDRESS_LEN } from '../crypto/address.js';
import { randomNonce } from '../crypto/random.js';
import { buildTransfer, serializePayload, signTx, balanceOnChain } from '../blockchain/validate.js';
import { pendingSpend } from '../blockchain/mempool.js';
import { broadcastTransaction, getActiveNode } from '../blockchain/runtime.js';

export default function SendScreen({ session }) {
  const algorithm = getAlgorithm(session.algorithmId);
  const node = getActiveNode();

  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [publicKeyInput, setPublicKeyInput] = useState('');
  const [signing, setSigning] = useState(false);
  const [result, setResult] = useState(null);
  const [rejection, setRejection] = useState(null);
  const [resetKey, setResetKey] = useState(0);

  const chain = node ? node.getChain() : [];
  const mempool = node ? node.getMempool() : [];
  const available = balanceOnChain(chain, session.address) - pendingSpend(mempool, session.address);

  // ---- Đèn trạng thái của ô public key ----
  // xám: chưa đủ độ dài | đỏ: băm không khớp | xanh: khớp
  const keyStatus = useMemo(() => {
    if (publicKeyInput.length !== algorithm.publicKeyHexLen) {
      return {
        tone: 'gray',
        text: `Cần ${algorithm.publicKeyHexLen} ký tự hex (${algorithm.publicKeyBytes} byte), đang có ${publicKeyInput.length}`,
      };
    }
    const derived = tryDeriveAddress(session.algorithmId, publicKeyInput);
    if (derived === null) {
      return { tone: 'red', text: 'Chuỗi không phải hex hợp lệ' };
    }
    if (derived !== session.address) {
      return {
        tone: 'red',
        text: `Public key này băm ra ${derived}`,
        derived,
      };
    }
    return { tone: 'green', text: 'Băm khớp với địa chỉ ví đang đăng nhập' };
  }, [publicKeyInput, algorithm, session]);

  // ---- Địa chỉ người nhận ----
  const recipient = useMemo(() => {
    if (to.length === 0) return { state: 'empty' };
    if (to.length !== ADDRESS_LEN) {
      return { state: 'bad', text: `Địa chỉ phải đủ ${ADDRESS_LEN} ký tự, đang có ${to.length}` };
    }
    const parsed = parseAddress(to);
    if (!parsed) {
      return { state: 'bad', text: 'Tiền tố phải là S0x hoặc E0x và phần còn lại phải là hex' };
    }
    return { state: 'ok', parsed };
  }, [to]);

  const amountValue = Number.parseInt(amount, 10);
  const amountValid = Number.isInteger(amountValue) && amountValue > 0;

  // Địa chỉ nhận sai thì CHẶN CỨNG — coin gửi vào địa chỉ không tồn tại là mất
  // vĩnh viễn. Còn public key sai thì VẪN CHO KÝ, xem chú thích ở dưới.
  const canSign = recipient.state === 'ok' && amountValid && publicKeyInput.length > 0;

  const draft = useMemo(
    () =>
      buildTransfer({
        // `from` là ĐÚNG CHUỖI người dùng gõ vào ô, không chỉnh sửa gì.
        from: publicKeyInput,
        // `fromAddr` LẤY TỪ SESSION VÍ ĐANG ĐĂNG NHẬP, không dẫn xuất từ ô nhập.
        // Nếu viết fromAddr = deriveAddress(publicKeyInput) thì hai vế của Luật 2
        // cùng đến từ một nguồn, gõ sai gì cũng "hợp lệ", và demo mất ý nghĩa.
        fromAddr: session.address,
        to,
        amount: amountValid ? amountValue : 0,
        sigAlg: session.algorithmId,
        timestamp: 0,
        nonce: '…',
      }),
    [publicKeyInput, session, to, amount]
  );

  const send = async () => {
    setSigning(true);
    setResult(null);
    setRejection(null);
    try {
      const tx = buildTransfer({
        from: publicKeyInput,
        fromAddr: session.address,
        to,
        amount: amountValue,
        sigAlg: session.algorithmId,
        timestamp: Date.now(),
        nonce: randomNonce(),
      });

      const startedAt = Date.now();
      const signed = await signTx(tx, session.privateKey);
      const signingMs = Date.now() - startedAt;

      setResult({ tx: signed, signingMs });

      // Phát cho node của chính mình trước. Node kiểm đủ bốn tầng và trả về lý do.
      const verdict = await node.receiveTransaction(signed);
      if (verdict.ok) {
        broadcastTransaction(signed);
        setTo('');
        setAmount('');
      } else {
        setRejection(verdict);
      }
    } catch (e) {
      setRejection({ rule: 'lỗi', detail: e.message });
    } finally {
      setSigning(false);
      setResetKey((k) => k + 1);
    }
  };

  return (
    <Screen>
      <Card title="Chuyển coin" subtitle={`Số dư khả dụng: ${available} coin`}>
        <Input
          label="Địa chỉ người nhận"
          value={to}
          onChangeText={(t) => setTo(t.trim())}
          placeholder="S0x… hoặc E0x…"
          monospace
          multiline
        />
        {recipient.state === 'ok' ? (
          <View style={styles.recipientOk}>
            <Text style={styles.arrow}>→ ví loại</Text>
            <WalletTypeBadge algorithmId={recipient.parsed.algorithmId} size="sm" showName />
          </View>
        ) : recipient.state === 'bad' ? (
          <Banner tone="error" title="Không gửi được tới địa chỉ này">
            {recipient.text} — coin gửi vào địa chỉ không tồn tại là mất vĩnh viễn nên app chặn
            ngay tại đây.
          </Banner>
        ) : null}

        <Input
          label="Số coin"
          value={amount}
          onChangeText={setAmount}
          placeholder="vd: 25"
          keyboardType="number-pad"
        />
      </Card>

      <Card
        title="Public key của bạn"
        subtitle="Ô này cố tình không điền sẵn. Gõ sai để xem blockchain từ chối như thế nào."
      >
        <Input
          value={publicKeyInput}
          onChangeText={(t) => setPublicKeyInput(t.trim().toLowerCase())}
          placeholder={`${algorithm.publicKeyHexLen} ký tự hex`}
          monospace
          multiline
        />
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: dotColor(keyStatus.tone) }]} />
          <Text style={[styles.statusText, { color: dotColor(keyStatus.tone) }]}>
            {keyStatus.text}
          </Text>
        </View>
        <Pressable onPress={() => setPublicKeyInput(session.publicKey)} hitSlop={6}>
          <Text style={styles.fillLink}>Điền public key của tôi</Text>
        </Pressable>
      </Card>

      <Card title="Nội dung sẽ ký">
        <View style={styles.payload}>
          <PayloadLine label="type" value={draft.type} />
          <PayloadLine label="from" value={shorten(publicKeyInput)} />
          <PayloadLine label="fromAddr" value={session.address} note="lấy từ ví đang đăng nhập" />
          <PayloadLine label="to" value={to || '—'} />
          <PayloadLine label="amount" value={amountValid ? String(amountValue) : '—'} />
          <PayloadLine label="sigAlg" value={session.algorithmId} highlight={algorithm.color} />
        </View>
        <Text style={styles.payloadNote}>
          Chuỗi thật được băm SHA-256 rồi ký là kết quả của serializePayload() — cùng một hàm dùng
          lúc ký, lúc verify và lúc hiện ở đây.
        </Text>
        <Mono style={styles.payloadRaw}>{shorten(serializePayload(draft), 160)}</Mono>
      </Card>

      {/* VẪN CHO TRƯỢT KÝ KHI ĐÈN ĐỎ. Chặn ở client thì giao dịch sai không bao giờ
          tới được node, và người dùng chỉ thấy validate của form chứ không thấy
          validate của blockchain. */}
      <SlideToSign
        label="Trượt để Xác nhận"
        onConfirm={send}
        disabled={!canSign}
        busy={signing}
        resetKey={resetKey}
      />
      {keyStatus.tone === 'red' && canSign ? (
        <Text style={styles.warnNote}>
          Public key đang sai nhưng bạn vẫn ký và phát đi được — node sẽ là bên từ chối, không phải
          cái form này.
        </Text>
      ) : null}

      {rejection ? (
        <Banner tone="error" title={`✗ Node của bạn từ chối giao dịch — Luật ${rejection.rule}`}>
          <View style={styles.rejectBody}>
            <Text style={styles.rejectText}>{rejection.detail}</Text>
            {rejection.rule === 2 && keyStatus.derived ? (
              <>
                <Text style={styles.rejectText}>Public key bạn nhập băm ra {keyStatus.derived}</Text>
                <Text style={styles.rejectText}>
                  Địa chỉ gửi trong giao dịch là {session.address}
                </Text>
              </>
            ) : null}
            <Text style={styles.rejectFoot}>
              Thông báo này đến từ node cục bộ trên máy bạn. Relay là relay câm, nó không trả về lý
              do từ chối.
            </Text>
          </View>
        </Banner>
      ) : null}

      {result ? <SignatureInfo tx={result.tx} signingMs={result.signingMs} /> : null}
    </Screen>
  );
}

function PayloadLine({ label, value, note, highlight }) {
  return (
    <View style={styles.payloadLine}>
      <Text style={styles.payloadKey}>{label}</Text>
      <View style={styles.payloadValueWrap}>
        <Text style={[styles.payloadValue, highlight && { color: highlight }]} numberOfLines={1}>
          {value}
        </Text>
        {note ? <Text style={styles.payloadNoteInline}>{note}</Text> : null}
      </View>
    </View>
  );
}

function dotColor(tone) {
  if (tone === 'green') return colors.ok;
  if (tone === 'red') return colors.danger;
  return colors.faint;
}

function shorten(text, max = 30) {
  if (!text) return '—';
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

const styles = StyleSheet.create({
  recipientOk: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrow: { color: colors.dim, fontSize: 13 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  fillLink: { color: colors.accent, fontSize: 12.5, fontWeight: '600' },
  payload: { backgroundColor: colors.cardAlt, borderRadius: 10, padding: 12, gap: 5 },
  payloadLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  payloadKey: { width: 76, color: colors.faint, fontFamily: mono, fontSize: 11.5 },
  payloadValueWrap: { flex: 1 },
  payloadValue: { color: colors.text, fontFamily: mono, fontSize: 11.5 },
  payloadNoteInline: { color: colors.faint, fontSize: 10.5, fontStyle: 'italic' },
  payloadNote: { color: colors.faint, fontSize: 12, lineHeight: 17 },
  payloadRaw: { color: colors.dim, fontSize: 10.5, lineHeight: 15 },
  warnNote: { color: colors.warn, fontSize: 12.5, lineHeight: 18 },
  rejectBody: { gap: 4 },
  rejectText: { color: colors.text, fontSize: 12.5, fontFamily: mono, lineHeight: 18 },
  rejectFoot: { color: colors.dim, fontSize: 12, lineHeight: 17, marginTop: 4 },
});
