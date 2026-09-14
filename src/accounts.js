// Sổ đăng ký account trên máy và cấu hình chung của app.
//
// VỀ NAMESPACE: mọi trạng thái NODE (chuỗi, mempool, bộ đếm đào) nằm dưới
// `v2:<address>:*` và tách biệt hoàn toàn giữa các account — xem node.js.
// Hai khoá dưới đây là ngoại lệ có chủ ý và chỉ có hai khoá này:
//   v2:accounts  — danh sách account để màn đăng nhập liệt kê ra được
//   v2:settings  — địa chỉ relay, thuộc về thiết bị chứ không thuộc về account
// Chúng không chứa trạng thái node nên không phá được sự cô lập.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import { getPublicKeyHex, isValidPrivateKeyHex, requireAlgorithm } from './crypto/algorithms.js';
import { deriveAddress } from './crypto/address.js';
import { encryptPrivateKey, decryptPrivateKey } from './crypto/vault.js';

const ACCOUNTS_KEY = 'v2:accounts';
const SETTINGS_KEY = 'v2:settings';

const DEFAULT_SETTINGS = {
  // RỖNG CÓ CHỦ Ý. Trước đây chỗ này ghi sẵn ws://192.168.1.10:3001 và nó đã gây
  // ra một buổi gỡ lỗi: IP bịa đó không tồn tại trên mạng của người dùng, app
  // lặng lẽ quay số vào hư không, mỗi 9 giây một lần, và giao diện chỉ hiện
  // "Đang kết nối…" nên trông y như đang sắp nối được.
  //
  // Rỗng thì connect() thoát ngay ở kiểm `!context.relayUrl`: không tạo
  // WebSocket, không có vòng thử lại, và màn Ví nói thẳng là chưa đặt địa chỉ.
  relayUrl: '',
};

const RELAY_PORT = 3001;

// Đoán địa chỉ relay từ máy đang chạy Metro.
//
// Điện thoại quét mã QR nên nó ĐÃ biết IP laptop — chính là host của bundle
// Metro. Relay chạy trên cùng laptop đó, chỉ khác cổng, nên ghép cổng 3001 vào
// là ra địa chỉ đúng trong đại đa số trường hợp.
//
// KHÔNG dùng expo-constants: gói đó không nằm trong danh sách thư viện của dự
// án và không resolve được từ mã app (nó chỉ tồn tại lồng trong node_modules
// của expo). `SourceCode` là native module có sẵn của react-native.
//
// GIỚI HẠN: chỉ có giá trị khi chạy qua Expo Go ở chế độ dev. Bản build
// production nạp bundle từ file nội bộ nên không có host nào để lấy — lúc đó
// hàm này trả về rỗng. KHÔNG bịa IP trong bất kỳ nhánh nào.
export function guessRelayUrl() {
  try {
    const source = NativeModules.SourceCode;
    const url = source?.getConstants?.().scriptURL ?? source?.scriptURL;
    if (!url) return '';
    // "http://192.168.42.4:8081/index.bundle?platform=android" -> "192.168.42.4"
    // Lớp ký tự chỉ nhận tên miền và IPv4; dạng IPv6 "[::1]" không khớp và rơi
    // về rỗng, thà không đoán còn hơn đoán ra một địa chỉ vô nghĩa.
    const match = /^https?:\/\/([A-Za-z0-9.-]+)/.exec(url);
    return match ? `ws://${match[1]}:${RELAY_PORT}` : '';
  } catch {
    return '';
  }
}

export async function listAccounts() {
  const raw = await AsyncStorage.getItem(ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAccounts(accounts) {
  await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

// Tạo account mới. Loại ví được chốt ở đây và KHÔNG có hàm nào đổi được về sau —
// muốn loại kia thì tạo account mới.
export async function createAccount({ username, password, privateKeyHex, algorithmId }) {
  const name = String(username || '').trim();
  if (name.length === 0) throw new Error('Tên đăng nhập không được để trống');
  if (!password) throw new Error('Password không được để trống');

  const algorithm = requireAlgorithm(algorithmId);
  if (!isValidPrivateKeyHex(algorithmId, privateKeyHex)) {
    throw new Error(
      `Private key không hợp lệ cho ví loại ${algorithm.letter}. ${algorithm.privateKeyRule}`
    );
  }

  const accounts = await listAccounts();
  if (accounts.some((a) => a.username.toLowerCase() === name.toLowerCase())) {
    throw new Error('Tên đăng nhập đã tồn tại trên máy này');
  }

  const publicKey = await getPublicKeyHex(algorithmId, privateKeyHex);
  const address = deriveAddress(algorithmId, publicKey);
  if (accounts.some((a) => a.address === address)) {
    throw new Error('Private key này đã được dùng cho một account khác trên máy');
  }

  const vault = await encryptPrivateKey(privateKeyHex, password);
  const account = { username: name, address, algorithmId, publicKey, vault, createdAt: Date.now() };
  await saveAccounts([...accounts, account]);
  return account;
}

// Mở khoá và trả về session. Private key CHỈ nằm trong RAM của session, không
// bao giờ ghi xuống đĩa ở dạng thô.
export async function unlockAccount(username, password) {
  const accounts = await listAccounts();
  const account = accounts.find((a) => a.username === username);
  if (!account) throw new Error('Không tìm thấy account');
  const privateKey = await decryptPrivateKey(account.vault, password);
  return {
    username: account.username,
    address: account.address,
    algorithmId: account.algorithmId,
    publicKey: account.publicKey,
    privateKey,
  };
}

export async function deleteAccount(username) {
  const accounts = await listAccounts();
  await saveAccounts(accounts.filter((a) => a.username !== username));
}

// Thứ tự ưu tiên của địa chỉ relay:
//   1. Giá trị người dùng đã lưu ở màn Cài đặt — LUÔN THẮNG, kể cả khi IP laptop
//      đã đổi và giá trị đoán được trông hợp lý hơn.
//   2. Chưa lưu gì thì đoán từ host Metro.
//   3. Đoán không ra thì để rỗng, màn Ví hiện "Chưa đặt địa chỉ relay".
//
// Giá trị đoán KHÔNG được ghi xuống đĩa. Nó được dựng lại mỗi lần khởi động nên
// tự bám theo laptop, và không bao giờ biến thành thứ ghi đè lựa chọn của người
// dùng ở lần chạy sau.
export async function getSettings() {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  let stored = null;
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
  }
  const settings = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  if (!settings.relayUrl) settings.relayUrl = guessRelayUrl();
  return settings;
}

export async function saveSettings(settings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
