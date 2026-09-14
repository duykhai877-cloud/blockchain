// Ví loại S — secp256k1 (ECDSA), chữ ký định dạng DER.
//
// Module này KHÔNG được import trực tiếp ở tầng blockchain hay màn hình.
// Mọi lời gọi phải đi qua algorithms.js để giữ đúng nguyên tắc một điểm dispatch.

import './hashes.js'; // phải chạy trước mọi lời gọi ký — xem chú thích trong hashes.js
import * as secp from '@noble/secp256k1';
import { bytesToHex, hexToBytes, isHex } from './bytes.js';
import { compactToDer, derToCompact } from './der.js';

export const PRIVATE_KEY_HEX_LEN = 64; // 32 byte
export const PUBLIC_KEY_HEX_LEN = 66; // 33 byte, dạng nén
export const PUBLIC_KEY_BYTES = 33;

// Ví loại S từ chối khoá bằng 0 hoặc >= bậc n của đường cong.
// Đây là điểm khác biệt then chốt so với Ed25519: cùng một chuỗi 64 hex có thể
// hợp lệ cho ví E nhưng bị từ chối ở đây.
export function isValidPrivateKeyHex(hex) {
  if (!isHex(hex, PRIVATE_KEY_HEX_LEN)) return false;
  try {
    // v3 đổi tên: v2 là utils.isValidPrivateKey, v3 là utils.isValidSecretKey.
    return secp.utils.isValidSecretKey(hexToBytes(hex));
  } catch {
    return false;
  }
}

export async function generatePrivateKeyHex() {
  return bytesToHex(secp.utils.randomSecretKey());
}

export async function getPublicKeyHex(privateKeyHex) {
  if (!isValidPrivateKeyHex(privateKeyHex)) {
    throw new Error('Private key không hợp lệ cho ví loại S');
  }
  return bytesToHex(secp.getPublicKey(hexToBytes(privateKeyHex), true));
}

export function isValidPublicKeyHex(hex) {
  if (!isHex(hex, PUBLIC_KEY_HEX_LEN)) return false;
  try {
    return secp.utils.isValidPublicKey(hexToBytes(hex));
  } catch {
    return false;
  }
}

// digest: Uint8Array 32 byte đã băm sẵn (SHA-256 của payload).
// prehash:false vì phần gọi đã tự băm — để mặc định true thì thư viện băm thêm
// một lần nữa và chữ ký sẽ không khớp với hàm verify của mình.
//
// Trả về { signature (DER hex), recovery }. Recovery id phải lấy NGAY LÚC KÝ:
// DER không mang theo nó và không tính ngược lại được từ hex.
export async function sign(digest, privateKeyHex, options = {}) {
  if (!isValidPrivateKeyHex(privateKeyHex)) {
    throw new Error('Private key không hợp lệ cho ví loại S');
  }
  const recovered = secp.sign(digest, hexToBytes(privateKeyHex), {
    prehash: false,
    format: 'recovered',
    extraEntropy: options.extraEntropy === true,
  });
  // format 'recovered' trả về 65 byte: [recovery, r(32), s(32)]
  const recovery = recovered[0];
  const compact = recovered.slice(1);
  return { signature: bytesToHex(compactToDer(compact)), recovery };
}

export async function verify(signatureHex, digest, publicKeyHex) {
  if (!isHex(signatureHex) || !isHex(publicKeyHex, PUBLIC_KEY_HEX_LEN)) return false;
  try {
    const compact = derToCompact(hexToBytes(signatureHex));
    return secp.verify(compact, digest, hexToBytes(publicKeyHex), { prehash: false });
  } catch {
    // DER hỏng, public key hỏng, hoặc chữ ký sai — mọi trường hợp đều là không hợp lệ.
    return false;
  }
}

// Khôi phục public key từ chữ ký + digest. Chỉ secp256k1 làm được việc này;
// Ed25519 không hỗ trợ. Cần recovery id đã lưu lúc ký.
export async function recoverPublicKeyHex(signatureHex, digest, recovery) {
  const compact = derToCompact(hexToBytes(signatureHex));
  const withRecovery = new Uint8Array(65);
  withRecovery[0] = recovery;
  withRecovery.set(compact, 1);
  // v3 trả thẳng Uint8Array 33 byte dạng nén, không phải đối tượng Point như v2.
  const publicKey = secp.recoverPublicKey(withRecovery, digest, {
    prehash: false,
    format: 'recovered',
  });
  return bytesToHex(publicKey);
}

export function signatureByteLength(signatureHex) {
  return signatureHex.length / 2;
}
