// PHẢI Ở DÒNG ĐẦU TIÊN, TRƯỚC MỌI IMPORT KHÁC.
// Cả @noble/secp256k1 lẫn @noble/ed25519 đều cần crypto.getRandomValues, mà React
// Native không có sẵn. Import này vá vào globalThis. Đặt sau bất kỳ import nào
// chạm tới hai thư viện đó là app crash ngay lúc sinh khoá.
import 'react-native-get-random-values';

// Gắn hàm băm cho hai thư viện noble. Cũng phải sớm: bản v3 không tự có sha256 /
// sha512, gọi trước khi gắn là ném lỗi "hashes.sha256 not set".
import './src/crypto/hashes.js';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors } from './src/theme.js';
import { getSettings } from './src/accounts.js';
import { startNode, stopNode } from './src/blockchain/runtime.js';
import AuthScreen from './src/screens/AuthScreen.js';
import WalletScreen from './src/screens/WalletScreen.js';
import SendScreen from './src/screens/SendScreen.js';
import LedgerScreen from './src/screens/LedgerScreen.js';
import CryptoLabScreen from './src/screens/CryptoLabScreen.js';
import SettingsScreen from './src/screens/SettingsScreen.js';

const Tab = createBottomTabNavigator();

const EMPTY_NODE_STATE = {
  connection: 'offline',
  mining: false,
  height: 1,
  mempool: 0,
  balance: 0,
  mined: 0,
};

const TAB_ICON = {
  Ví: '◆',
  Gửi: '↗',
  'Sổ cái': '▤',
  Lab: '⚗',
  'Cài đặt': '⚙',
};

const navigationTheme = {
  dark: true,
  colors: {
    primary: colors.accent,
    background: colors.bg,
    card: colors.card,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '800' },
  },
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(null);
  const [session, setSession] = useState(null);
  const [nodeState, setNodeState] = useState(EMPTY_NODE_STATE);
  const [starting, setStarting] = useState(false);

  // Session hiện tại dưới dạng ref: callback trạng thái của node chạy bất đồng bộ
  // nên phải so chủ sở hữu với session ĐANG có, không phải session lúc đăng ký callback.
  const sessionRef = useRef(null);

  useEffect(() => {
    getSettings().then((loaded) => {
      setSettings(loaded);
      setReady(true);
    });
  }, []);

  const handleNodeState = useCallback((state) => {
    // Hàng rào cuối cùng ở tầng UI: trạng thái của node thuộc account khác thì bỏ.
    if (!sessionRef.current || state.owner !== sessionRef.current.address) return;
    setNodeState(state);
  }, []);

  const launch = useCallback(
    async (nextSession, relayUrl) => {
      setStarting(true);
      sessionRef.current = nextSession;
      setNodeState(EMPTY_NODE_STATE);
      try {
        await startNode({
          owner: nextSession.address,
          relayUrl,
          storage: AsyncStorage,
          onState: handleNodeState,
        });
      } finally {
        setStarting(false);
      }
    },
    [handleNodeState]
  );

  const signIn = async (nextSession) => {
    setSession(nextSession);
    await launch(nextSession, settings.relayUrl);
  };

  // Đăng xuất phải DỪNG HẲN node trước khi bỏ session. Chỉ setSession(null) thôi
  // thì vòng đào cũ vẫn chạy và sẽ đúc coinbase cho account đăng nhập sau.
  const signOut = async () => {
    await stopNode();
    sessionRef.current = null;
    setSession(null);
    setNodeState(EMPTY_NODE_STATE);
  };

  const applySettings = async (next) => {
    setSettings(next);
    if (sessionRef.current) await launch(sessionRef.current, next.relayUrl);
  };

  useEffect(() => {
    // App bị gỡ khỏi cây: dừng node để vòng đào không sống tiếp.
    return () => {
      void stopNode();
    };
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
        <StatusBar style="light" />
      </View>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <AuthScreen onSignedIn={signIn} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={navigationTheme}>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerStyle: { backgroundColor: colors.card },
            headerTitleStyle: { color: colors.text, fontSize: 16 },
            headerShadowVisible: false,
            tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.faint,
            tabBarLabelStyle: { fontSize: 11 },
            tabBarIcon: ({ color }) => (
              <Text style={{ color, fontSize: 16 }}>{TAB_ICON[route.name]}</Text>
            ),
          })}
        >
          <Tab.Screen name="Ví" options={{ title: `Ví · ${session.username}` }}>
            {() => (
              <WalletScreen
                session={session}
                nodeState={nodeState}
                relayUrl={settings.relayUrl}
                onLogout={signOut}
              />
            )}
          </Tab.Screen>
          <Tab.Screen name="Gửi">{() => <SendScreen session={session} />}</Tab.Screen>
          <Tab.Screen name="Sổ cái">
            {() => <LedgerScreen session={session} nodeState={nodeState} />}
          </Tab.Screen>
          <Tab.Screen name="Lab" options={{ title: 'Phòng thí nghiệm mã hoá' }}>
            {() => <CryptoLabScreen />}
          </Tab.Screen>
          <Tab.Screen name="Cài đặt">
            {() => (
              <SettingsScreen
                session={session}
                settings={settings}
                nodeState={nodeState}
                onSettingsChanged={applySettings}
                onLogout={signOut}
              />
            )}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
      {starting ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.overlayText}>Đang khởi động node…</Text>
        </View>
      ) : null}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    backgroundColor: '#0d1117cc',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  overlayText: { color: colors.text, fontSize: 13 },
});
