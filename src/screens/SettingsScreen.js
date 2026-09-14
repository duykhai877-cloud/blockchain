// Cài đặt — địa chỉ relay và vài thao tác bảo trì node.
//
// Địa chỉ relay thuộc về THIẾT BỊ chứ không thuộc về account, nên nó nằm ở
// v2:settings chứ không nằm trong namespace v2:<address>:*.

import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, Card, Button, Input, Banner, StatRow, CopyRow } from '../components/ui.js';
import { colors } from '../theme.js';
import { saveSettings } from '../accounts.js';
import { nodeStorageKeys } from '../blockchain/node.js';
import { getActiveNode, getConnectionState, requestChain } from '../blockchain/runtime.js';
import { DIFFICULTY, COINBASE_REWARD, FAUCET_AMOUNT, GENESIS_TIMESTAMP } from '../blockchain/constants.js';

const URL_PATTERN = /^wss?:\/\/[^\s/]+(:\d+)?(\/.*)?$/;

export default function SettingsScreen({ session, settings, nodeState, onSettingsChanged, onLogout }) {
  const [relayUrl, setRelayUrl] = useState(settings.relayUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(null);
  const [syncError, setSyncError] = useState(null);

  const node = getActiveNode();
  const chain = node ? node.getChain() : [];
  const genesis = chain.length > 0 ? chain[0] : null;
  const valid = URL_PATTERN.test(relayUrl.trim());
  const changed = relayUrl.trim() !== settings.relayUrl;

  const apply = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const next = { ...settings, relayUrl: relayUrl.trim() };
      await saveSettings(next);
      // Đổi relay là phải dựng lại node: socket cũ trỏ vào địa chỉ cũ.
      await onSettingsChanged(next);
      setMessage({ tone: 'ok', text: 'Đã lưu và kết nối lại theo địa chỉ mới.' });
    } catch (e) {
      setMessage({ tone: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  // Xem ghi chú ở WalletScreen: stopNode() lỗi thì KHÔNG được xoá session, vì
  // vòng đào cũ còn sống sẽ đúc coinbase cho account đăng nhập sau.
  const logout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await onLogout();
    } catch (e) {
      setLogoutError(`Không dừng được node: ${e.message}. Thử lại.`);
    } finally {
      setLoggingOut(false);
    }
  };

  const sync = () => {
    setSyncError(null);
    try {
      requestChain();
    } catch (e) {
      setSyncError(e.message);
    }
  };

  return (
    <Screen>
      <Card title="Relay">
        <Text style={styles.hint}>
          Relay là một máy chủ CÂM chạy trên laptop: nó chỉ chuyển tiếp gói tin, không kiểm tra gì,
          không giữ chuỗi, không đào. Hai điện thoại đều là full node và đều tự validate lại mọi thứ
          nhận được, nên relay có nói dối cũng không lừa được ai.
        </Text>
        <Input
          label="Địa chỉ WebSocket"
          value={relayUrl}
          onChangeText={setRelayUrl}
          placeholder="ws://192.168.1.10:3001"
          monospace
          autoCapitalize="none"
          hint="Lấy IP LAN của laptop đang chạy `npm run relay`. Điện thoại và laptop phải chung một mạng Wi-Fi."
        />
        {!valid && relayUrl.length > 0 ? (
          <Banner tone="error" title="Địa chỉ sai định dạng">
            Phải bắt đầu bằng ws:// hoặc wss://, ví dụ ws://192.168.1.10:3001
          </Banner>
        ) : null}
        <Button
          title="Lưu và kết nối lại"
          onPress={apply}
          busy={busy}
          disabled={!valid || !changed}
        />
        {message ? (
          <Banner tone={message.tone} title={message.tone === 'ok' ? 'Xong' : 'Lỗi'}>
            {message.text}
          </Banner>
        ) : null}
        <StatRow
          label="Trạng thái hiện tại"
          value={getConnectionState()}
          valueColor={nodeState.connection === 'online' ? colors.ok : colors.warn}
        />
        <Button title="Xin lại chuỗi từ mạng" tone="ghost" onPress={sync} />
        {syncError ? (
          <Banner tone="error" title="Không gửi được yêu cầu">{syncError}</Banner>
        ) : null}
      </Card>

      <Card title="Luật đồng thuận">
        <Text style={styles.hint}>
          Những con số này giống hệt nhau trên mọi node. Sửa một số ở đây mà không sửa ở máy kia thì
          hai máy không bao giờ đồng bộ được.
        </Text>
        <StatRow label="Độ khó (số 0 đầu hash)" value={`${DIFFICULTY}`} />
        <StatRow label="Thưởng đào mỗi block" value={`${COINBASE_REWARD} coin`} />
        <StatRow label="Faucet mỗi địa chỉ" value={`${FAUCET_AMOUNT} coin, một lần duy nhất`} />
        <StatRow
          label="Genesis timestamp"
          value={new Date(GENESIS_TIMESTAMP).toISOString().slice(0, 19)}
        />
        {genesis ? (
          <CopyRow label="Genesis hash" value={genesis.hash} />
        ) : null}
        <Text style={styles.hint}>
          Genesis dùng timestamp viết cứng. Nếu lấy Date.now() thì hai điện thoại sẽ có hai block
          đầu tiên khác nhau và không đời nào đồng bộ nổi.
        </Text>
      </Card>

      <Card title="Lưu trữ của account này">
        <Text style={styles.hint}>
          Mỗi account có chuỗi, mempool và bộ đếm đào riêng. Đăng nhập account khác trên cùng máy
          không đụng gì tới dữ liệu ở đây.
        </Text>
        {nodeStorageKeys(session.address).map((key) => (
          <Text key={key} style={styles.storageKey}>
            {key}
          </Text>
        ))}
      </Card>

      <Card title="Phiên đăng nhập">
        <Text style={styles.hint}>
          Đăng xuất sẽ dừng HẲN node: vòng đào, heartbeat và WebSocket đều tắt. Private key trong
          RAM bị bỏ đi, muốn dùng lại phải nhập password.
        </Text>
        <Button title="Đăng xuất" tone="danger" onPress={logout} busy={loggingOut} />
        {logoutError ? (
          <Banner tone="error" title="Chưa đăng xuất">{logoutError}</Banner>
        ) : null}
      </Card>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Dự án học tập. Ví này không dùng cho tiền thật: khoá nằm trên điện thoại, mã hoá bằng một
          hàm tự viết để minh hoạ, và mạng chỉ có một relay không xác thực.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.dim, fontSize: 12.5, lineHeight: 18 },
  storageKey: { color: colors.faint, fontSize: 11.5, fontFamily: 'monospace' },
  footer: { paddingHorizontal: 4 },
  footerText: { color: colors.faint, fontSize: 11.5, lineHeight: 17 },
});
