// Màn ví — khoá, số dư, trạng thái node, đào, faucet.

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, Card, Button, Banner, StatRow, CopyRow } from '../components/ui.js';
import WalletTypeBadge from '../components/WalletTypeBadge.js';
import { colors, mono } from '../theme.js';
import { guessRelayUrl } from '../accounts.js';
import { getAlgorithm } from '../crypto/algorithms.js';
import { randomNonce } from '../crypto/random.js';
import { buildFaucet, signTx, collectFaucetClaims, balanceOnChain } from '../blockchain/validate.js';
import { pendingSpend, hasPendingFaucet } from '../blockchain/mempool.js';
import { FAUCET_AMOUNT } from '../blockchain/constants.js';
import {
  broadcastTransaction,
  getActiveNode,
  isMining,
  requestChain,
  startMining,
  stopMining,
} from '../blockchain/runtime.js';

const CONNECTION_LABEL = {
  online: 'Đã kết nối relay',
  connecting: 'Đang kết nối…',
  offline: 'Chưa kết nối',
  error: 'Lỗi kết nối',
};

const CONNECTION_COLOR = {
  online: colors.ok,
  connecting: colors.warn,
  offline: colors.faint,
  error: colors.danger,
};

export default function WalletScreen({ session, nodeState, relayUrl, onLogout }) {
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [message, setMessage] = useState(null);
  const algorithm = getAlgorithm(session.algorithmId);
  const node = getActiveNode();

  const chain = node ? node.getChain() : [];
  const mempool = node ? node.getMempool() : [];
  const confirmed = node ? balanceOnChain(chain, session.address) : 0;
  const pending = pendingSpend(mempool, session.address);

  const faucetBlock = collectFaucetClaims(chain).get(session.address);
  const faucetPending = hasPendingFaucet(mempool, session.address);
  const faucetState = faucetBlock !== undefined ? 'claimed' : faucetPending ? 'pending' : 'available';

  const claimFaucet = async () => {
    setFaucetBusy(true);
    setMessage(null);
    try {
      const tx = await signTx(
        buildFaucet({
          from: session.publicKey,
          fromAddr: session.address,
          sigAlg: session.algorithmId,
          timestamp: Date.now(),
          nonce: randomNonce(),
        }),
        session.privateKey
      );
      const result = await node.receiveTransaction(tx);
      if (result.ok) {
        broadcastTransaction(tx);
        setMessage({ tone: 'ok', text: 'Đã phát giao dịch faucet. Chờ một block để xác nhận.' });
      } else {
        setMessage({ tone: 'error', text: `Node của bạn từ chối: ${result.detail}` });
      }
    } catch (e) {
      setMessage({ tone: 'error', text: e.message });
    } finally {
      setFaucetBusy(false);
    }
  };

  // Đăng xuất chỉ được coi là xong khi node đã dừng HẲN. stopNode() lỗi mà vẫn
  // xoá session thì vòng đào cũ có thể sống tiếp và đúc coinbase cho account
  // đăng nhập sau — lỗi này đã xảy ra một lần. Thà kẹt lại đây còn hơn đăng
  // xuất giả. App.signOut đã xếp đúng thứ tự: await stopNode() trước, xoá
  // session sau, nên chỉ cần để lỗi ném ra tới đây là session tự động còn nguyên.
  const logout = async () => {
    setLoggingOut(true);
    setMessage(null);
    try {
      await onLogout();
    } catch (e) {
      setMessage({
        tone: 'error',
        title: 'Chưa đăng xuất',
        text: `Không dừng được node: ${e.message}. Thử lại.`,
      });
    } finally {
      setLoggingOut(false);
    }
  };

  const toggleMining = () => {
    setMessage(null);
    try {
      if (isMining()) stopMining();
      else startMining();
    } catch (e) {
      setMessage({ tone: 'error', title: 'Không đổi được trạng thái đào', text: e.message });
    }
  };

  const sync = () => {
    setMessage(null);
    try {
      requestChain();
    } catch (e) {
      setMessage({ tone: 'error', title: 'Không gửi được yêu cầu', text: e.message });
    }
  };

  const mining = isMining();

  // Chưa đặt địa chỉ thì runtime không tạo socket, connection nằm im ở 'offline'
  // — cùng giá trị với ca "đã đặt nhưng rớt mạng". Hai ca đó cần hai câu khác
  // nhau, mà chỉ nhìn nodeState thì không phân biệt được, nên phải xét relayUrl.
  const hasRelay = Boolean(relayUrl && relayUrl.trim());

  // So thẳng với giá trị đoán được thay vì lưu một lá cờ: cờ sẽ phải nằm trong
  // object settings, mà SettingsScreen.apply() trải nguyên object đó xuống đĩa,
  // nên cờ sẽ bị ghi lại và mắc kẹt ở giá trị cũ sau khi người dùng sửa tay.
  const isGuess = hasRelay && relayUrl === guessRelayUrl();

  return (
    <Screen>
      <Card>
        <View style={styles.identity}>
          <WalletTypeBadge algorithmId={session.algorithmId} />
          <View style={styles.identityText}>
            <Text style={styles.username}>{session.username}</Text>
            <Text style={styles.algorithmName}>{algorithm.fullName}</Text>
          </View>
          <Button
            title="Đăng xuất"
            tone="ghost"
            onPress={logout}
            busy={loggingOut}
            style={styles.logout}
          />
        </View>

        <View style={styles.balanceBox}>
          <Text style={styles.balanceLabel}>Số dư đã xác nhận</Text>
          <Text style={styles.balanceValue}>{confirmed} coin</Text>
          {pending > 0 ? (
            <Text style={styles.balancePending}>Đang chờ gửi đi: {pending} coin</Text>
          ) : null}
        </View>
      </Card>

      {message ? (
        <Banner
          tone={message.tone}
          title={message.title || (message.tone === 'ok' ? 'Đã gửi' : 'Bị từ chối')}
        >
          {message.text}
        </Banner>
      ) : null}

      <Card title="Faucet">
        {faucetState === 'claimed' ? (
          <>
            <Text style={styles.faucetDone}>Đã nhận {FAUCET_AMOUNT} coin ở block #{faucetBlock}</Text>
            <Button title="Đã nhận" disabled />
          </>
        ) : faucetState === 'pending' ? (
          <>
            <Text style={styles.faucetHint}>
              Giao dịch faucet đang nằm trong mempool, cần một block để xác nhận.
            </Text>
            <Button title="Đang chờ xác nhận…" disabled />
          </>
        ) : (
          <>
            <Text style={styles.faucetHint}>
              Mỗi địa chỉ chỉ nhận được một lần. Luật này nằm trong đồng thuận nên node khác cũng
              kiểm được, không phải cờ cục bộ.
            </Text>
            <Button title={`Nhận ${FAUCET_AMOUNT} coin`} onPress={claimFaucet} busy={faucetBusy} />
          </>
        )}
      </Card>

      <Card title="Khoá của ví">
        <CopyRow label="Địa chỉ" value={session.address} badge="43 ký tự" />
        <CopyRow
          label="Public key"
          value={session.publicKey}
          badge={`${algorithm.publicKeyBytes} byte`}
        />
        <CopyRow label="Private key" value={session.privateKey} secret badge="32 byte" />
      </Card>

      <Card title="Node của bạn">
        <StatRow
          label="Kết nối relay"
          value={
            hasRelay
              ? CONNECTION_LABEL[nodeState.connection] || nodeState.connection
              : 'Chưa đặt địa chỉ relay'
          }
          valueColor={hasRelay ? CONNECTION_COLOR[nodeState.connection] : colors.warn}
        />
        {/* Địa chỉ đang quay số phải hiện ngay đây. Thiếu dòng này thì app gõ
            nhầm IP trông y hệt app mất mạng, và người dùng không có cách nào
            biết mình đang gọi vào đâu. */}
        <Text style={hasRelay ? styles.relayUrl : styles.relayHint}>
          {hasRelay ? relayUrl : 'Vào tab Cài đặt để nhập địa chỉ WebSocket của laptop.'}
        </Text>
        {isGuess ? <Text style={styles.relayGuess}>Tự dò từ máy chạy Metro</Text> : null}
        <StatRow label="Chiều cao chuỗi" value={`${chain.length} block`} />
        <StatRow label="Giao dịch trong mempool" value={`${mempool.length}`} />
        <StatRow label="Block đã đào" value={`${nodeState.mined || 0}`} />
        <View style={styles.actions}>
          <Button
            title={mining ? 'Dừng đào' : 'Bắt đầu đào'}
            tone={mining ? 'danger' : 'primary'}
            onPress={toggleMining}
            style={styles.flex}
          />
          <Button title="Đồng bộ" tone="ghost" onPress={sync} style={styles.flex} />
        </View>
        {mining ? (
          <Text style={styles.miningHint}>
            Đang thử nonce… vòng đào nhả luồng định kỳ nên màn hình vẫn dùng được bình thường.
          </Text>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  identityText: { flex: 1 },
  username: { color: colors.text, fontSize: 17, fontWeight: '700' },
  algorithmName: { color: colors.dim, fontSize: 12.5 },
  logout: { paddingVertical: 8, paddingHorizontal: 12 },
  balanceBox: { paddingTop: 12, gap: 2 },
  balanceLabel: { color: colors.dim, fontSize: 13 },
  balanceValue: { color: colors.text, fontSize: 32, fontWeight: '700' },
  balancePending: { color: colors.warn, fontSize: 13 },
  faucetHint: { color: colors.dim, fontSize: 13, lineHeight: 19 },
  faucetDone: { color: colors.ok, fontSize: 13.5, fontWeight: '600' },
  relayUrl: { color: colors.faint, fontSize: 11.5, fontFamily: mono, marginTop: -4 },
  relayHint: { color: colors.warn, fontSize: 12, lineHeight: 17, marginTop: -4 },
  relayGuess: { color: colors.dim, fontSize: 11, marginTop: -6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
  miningHint: { color: colors.faint, fontSize: 12, lineHeight: 17 },
});
