// Nguồn ngẫu nhiên duy nhất của dự án.
//
// Trên React Native, `crypto.getRandomValues` KHÔNG có sẵn — nó được vá vào bởi
// `react-native-get-random-values`, thư viện phải được import ở DÒNG ĐẦU TIÊN
// của App.js trước mọi import khác. Cả @noble/secp256k1 và @noble/ed25519 đều
// gọi thẳng vào nó khi sinh khoá, nên nếu import muộn thì sinh khoá sẽ throw.
//
// Trên Node (dùng khi chạy script test) hàm này có sẵn từ v19 nên không cần vá.

export function randomBytes(length) {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

// Chuỗi ngẫu nhiên dùng làm `nonce` của giao dịch — chống hai giao dịch giống
// hệt nhau băm ra cùng một payload.
export function randomNonce() {
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
