// Ví loại E — Ed25519 (EdDSA), chữ ký raw 64 byte.
//
// Module này KHÔNG được import trực tiếp ở tầng blockchain hay màn hình.
// Mọi lời gọi phải đi qua algorithms.js.

import './hashes.js'; // phải chạy trước mọi lời gọi ký
import * as ed from '@noble/ed25519';
import { bytesToHex, hexToBytes, isHex } from './bytes.js';

export const PRIVATE_KEY_HEX_LEN = 64; // 32 byte
export const PUBLIC_KEY_HEX_LEN = 64; // 32 byte
export const PUBLIC_KEY_BYTES = 32;

// Ed25519 băm private key trước khi dùng (clamping), nên MỌI chuỗi 32 byte đều
// là khoá hợp lệ. Không có khái niệm "vượt quá bậc n" như secp256k1.
// Đây chính là lý do cùng một chuỗi hex có thể hợp lệ ở đây nhưng bị ví S từ chối.
export function isValidPrivateKeyHex(hex) {
  return isHex(hex, PRIVATE_KEY_HEX_LEN);
}

export async function generatePrivateKeyHex() {
  return bytesToHex(ed.utils.randomSecretKey());
}

export async function getPublicKeyHex(privateKeyHex) {
  if (!isValidPrivateKeyHex(privateKeyHex)) {
    throw new Error('Private key không hợp lệ cho ví loại E');
  }
  return bytesToHex(ed.getPublicKey(hexToBytes(privateKeyHex)));
}

export function isValidPublicKeyHex(hex) {
  if (!isHex(hex, PUBLIC_KEY_HEX_LEN)) return false;
  try {
    ed.Point.fromBytes(hexToBytes(hex));
    return true;
  } catch {
    return false;
  }
}

// Ed25519 ký trực tiếp trên thông điệp (nội bộ nó tự băm SHA-512 hai lần theo
// thiết kế). Ở đây thông điệp truyền vào là digest SHA-256 của payload, giống
// hệt thứ mà ví loại S ký — để hai bên so sánh được trên cùng một đầu vào.
//
// Không có tuỳ chọn extraEntropy: Ed25519 tất định BẮT BUỘC theo RFC 8032,
// nonce được dẫn xuất từ private key và thông điệp. Không cách nào đổi được.
export async function sign(digest, privateKeyHex) {
  if (!isValidPrivateKeyHex(privateKeyHex)) {
    throw new Error('Private key không hợp lệ cho ví loại E');
  }
  return { signature: bytesToHex(ed.sign(digest, hexToBytes(privateKeyHex))), recovery: null };
}

export async function verify(signatureHex, digest, publicKeyHex) {
  if (!isHex(signatureHex, 128) || !isHex(publicKeyHex, PUBLIC_KEY_HEX_LEN)) return false;
  try {
    return ed.verify(hexToBytes(signatureHex), digest, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export function signatureByteLength(signatureHex) {
  return signatureHex.length / 2;
}
