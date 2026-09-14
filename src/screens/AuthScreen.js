// Đăng nhập và đăng ký.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Screen, Card, Button, Input, Banner } from '../components/ui.js';
import WalletTypeBadge from '../components/WalletTypeBadge.js';
import { colors } from '../theme.js';
import { listAlgorithms, generatePrivateKeyHex, isValidPrivateKeyHex } from '../crypto/algorithms.js';
import { createAccount, listAccounts, unlockAccount, deleteAccount } from '../accounts.js';

export default function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState(null);
  // Username vừa đăng ký, để tab Đăng nhập chọn sẵn đúng account đó.
  const [justRegistered, setJustRegistered] = useState(null);

  const reload = useCallback(async () => {
    const list = await listAccounts();
    setAccounts(list);
    if (list.length === 0) setMode('register');
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.appTitle}>Ví hai loại chữ ký</Text>
        <Text style={styles.appSub}>secp256k1 và Ed25519 trên cùng một blockchain</Text>
      </View>

      <View style={styles.tabs}>
        <Pressable
          onPress={() => { setMode('login'); setError(null); }}
          style={[styles.tab, mode === 'login' && styles.tabActive]}
        >
          <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Đăng nhập</Text>
        </Pressable>
        <Pressable
          onPress={() => { setMode('register'); setError(null); }}
          style={[styles.tab, mode === 'register' && styles.tabActive]}
        >
          <Text style={[styles.tabText, mode === 'register' && styles.tabTextActive]}>Đăng ký</Text>
        </Pressable>
      </View>

      {error ? <Banner tone="error" title="Không thành công">{error}</Banner> : null}

      {mode === 'login' ? (
        <LoginPanel
          accounts={accounts}
          preselectUsername={justRegistered}
          onError={setError}
          onSignedIn={onSignedIn}
          onDeleted={reload}
        />
      ) : (
        <RegisterPanel
          onError={setError}
          onCreated={async (username) => {
            await reload();
            setJustRegistered(username);
            setMode('login');
          }}
        />
      )}
    </Screen>
  );
}

function LoginPanel({ accounts, preselectUsername, onError, onSignedIn, onDeleted }) {
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Vừa đăng ký xong: chọn sẵn account đó để người dùng chỉ còn phải nhập
  // password. Hook này phải nằm TRƯỚC nhánh return sớm bên dưới.
  useEffect(() => {
    if (!preselectUsername) return;
    const match = accounts.find((a) => a.username === preselectUsername);
    if (match) setSelected(match);
  }, [preselectUsername, accounts]);

  if (accounts.length === 0) {
    return <Card subtitle="Chưa có account nào trên máy này. Chuyển sang tab Đăng ký để tạo." />;
  }

  const signIn = async () => {
    setBusy(true);
    onError(null);
    try {
      const session = await unlockAccount(selected.username, password);
      setPassword('');
      onSignedIn(session);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    onError(null);
    try {
      await deleteAccount(selected.username);
      setSelected(null);
      setPassword('');
      await onDeleted();
    } catch (e) {
      onError(e.message);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Card title="Chọn account">
      {/* Huy hiệu loại ví PHẢI có ở đây. Không có nó thì người dùng phải đăng nhập
          xong mới biết mình vừa vào ví loại nào. */}
      {accounts.map((account) => {
        const active = selected && selected.username === account.username;
        return (
          <Pressable
            key={account.username}
            onPress={() => setSelected(account)}
            style={[styles.accountRow, active && styles.accountRowActive]}
          >
            <WalletTypeBadge algorithmId={account.algorithmId} />
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>{account.username}</Text>
              <Text style={styles.accountAddr} numberOfLines={1}>
                {account.address}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {selected ? (
        <View style={styles.loginForm}>
          <Input
            label={`Password của ${selected.username}`}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Nhập password"
            autoFocus={selected.username === preselectUsername}
          />
          {/* Mở khoá cũng phải chạy PBKDF2 y hệt lúc đăng ký, tốn chừng ấy thời
              gian. Nhãn phải có ở cả hai chỗ, không chỉ ở màn đăng ký. */}
          <Button
            title="Mở khoá ví"
            busyTitle="Đang mã hoá khoá…"
            onPress={signIn}
            busy={busy}
            disabled={!password}
          />
          <Button
            title="Xoá account này khỏi máy"
            tone="ghost"
            onPress={remove}
            busy={removing}
          />
        </View>
      ) : null}
    </Card>
  );
}

function RegisterPanel({ onError, onCreated }) {
  const algorithms = listAlgorithms();
  const [algorithmId, setAlgorithmId] = useState(algorithms[0].id);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);

  const selected = algorithms.find((a) => a.id === algorithmId);
  const keyLooksValid = privateKey.length === 0 || isValidPrivateKeyHex(algorithmId, privateKey);

  // Sinh khoá theo ràng buộc của loại ĐANG CHỌN — ví S và ví E có luật khác nhau.
  const generate = async () => {
    setGenerating(true);
    onError(null);
    try {
      setPrivateKey(await generatePrivateKeyHex(algorithmId));
    } catch (e) {
      onError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    onError(null);
    try {
      // Dùng username từ account trả về: createAccount trim tên, nên chuỗi này
      // mới khớp đúng với a.username lúc tab Đăng nhập dò tìm.
      const account = await createAccount({
        username,
        password,
        privateKeyHex: privateKey,
        algorithmId,
      });
      setUsername('');
      setPassword('');
      setPrivateKey('');
      await onCreated(account.username);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Chọn loại ví">
        <View style={styles.typeCards}>
          {algorithms.map((algorithm) => {
            const active = algorithm.id === algorithmId;
            return (
              <Pressable
                key={algorithm.id}
                onPress={() => setAlgorithmId(algorithm.id)}
                style={[
                  styles.typeCard,
                  { borderColor: active ? algorithm.color : colors.border },
                  active && { backgroundColor: algorithm.color + '14' },
                ]}
              >
                <WalletTypeBadge algorithmId={algorithm.id} />
                {/* Nói bằng ngôn ngữ "ai đang dùng" TRƯỚC, thông số byte SAU. */}
                <Text style={styles.typeUsedBy}>{algorithm.usedBy}</Text>
                <Text style={[styles.typeName, { color: algorithm.color }]}>{algorithm.name}</Text>
                <View style={styles.typeSpecs}>
                  <Text style={styles.typeSpec}>Public key {algorithm.publicKeyBytes} byte</Text>
                  <Text style={styles.typeSpec}>
                    Chữ ký {algorithm.signatureFormat} {algorithm.signatureBytesLabel}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card title="Thông tin đăng nhập">
        <Input label="Tên đăng nhập" value={username} onChangeText={setUsername} placeholder="vd: khai" />
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Dùng để mã hoá private key"
          hint="Password không được lưu ở đâu cả. Quên là mất ví, không khôi phục được."
        />
      </Card>

      <Card title="Private key">
        <Input
          value={privateKey}
          onChangeText={(t) => setPrivateKey(t.trim().toLowerCase())}
          placeholder="64 ký tự hex"
          monospace
          multiline
          hint={selected.privateKeyRule}
        />
        {!keyLooksValid ? (
          <Banner tone="error" title={`Không hợp lệ cho ví loại ${selected.letter}`}>
            {privateKey.length !== 64
              ? `Cần đúng 64 ký tự hex, đang có ${privateKey.length}.`
              : selected.privateKeyRule}
          </Banner>
        ) : null}
        <Button
          title={`Sinh private key ngẫu nhiên cho ví ${selected.letter}`}
          tone="ghost"
          onPress={generate}
          busy={generating}
        />
      </Card>

      <Banner tone="warn" title="Loại ví không đổi được sau khi đăng ký">
        Account này sẽ vĩnh viễn dùng {selected.fullName}. Muốn loại kia thì phải tạo một account
        mới — không có cách nào chuyển đổi.
      </Banner>

      <Button
        title="Tạo ví"
        busyTitle="Đang mã hoá khoá…"
        onPress={submit}
        busy={busy}
        disabled={!username || !password || !isValidPrivateKeyHex(algorithmId, privateKey)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingTop: 12, gap: 4 },
  appTitle: { color: colors.text, fontSize: 22, fontWeight: '700' },
  appSub: { color: colors.dim, fontSize: 13 },
  tabs: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 10, padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 7, alignItems: 'center' },
  tabActive: { backgroundColor: colors.cardAlt },
  tabText: { color: colors.dim, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: colors.text },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountRowActive: { borderColor: colors.accent, backgroundColor: colors.accent + '12' },
  accountInfo: { flex: 1, gap: 2 },
  accountName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  accountAddr: { color: colors.faint, fontSize: 11, fontFamily: 'monospace' },
  loginForm: { gap: 10, marginTop: 4 },
  typeCards: { flexDirection: 'row', gap: 10 },
  typeCard: { flex: 1, borderWidth: 1.5, borderRadius: 12, padding: 12, gap: 6 },
  typeUsedBy: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  typeName: { fontSize: 12, fontWeight: '600' },
  typeSpecs: { gap: 2, marginTop: 2 },
  typeSpec: { color: colors.faint, fontSize: 11.5, lineHeight: 16 },
});
