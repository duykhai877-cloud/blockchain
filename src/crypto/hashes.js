// Nơi DUY NHẤT gán hàm băm cho hai thư viện @noble.
//
// BẪY THƯ VIỆN: bản cài được cho Expo SDK 54 là @noble/secp256k1 v3 và
// @noble/ed25519 v3, KHÔNG phải v2. API v3 khác v2:
//   - v2 dùng `ed.etc.sha512Sync = ...`
//   - v3 dùng `ed.hashes.sha512 = ...` và secp cần thêm `hashes.hmacSha256`
// Không gán thì mọi lời gọi ký/verify đồng bộ đều throw "hashes.sha256 not set".
//
// File này phải được import trước mọi lời gọi ký. Các module secp256k1.js và
// ed25519.js đều import nó nên chỉ cần đi qua algorithms.js là đã an toàn.
//
// @noble/hashes v2 đổi đường dẫn export: sha256/sha512 nằm ở 'sha2.js'
// (v1 tách thành 'sha256.js' và 'sha512.js'). Bắt buộc ghi đuôi .js.
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import * as secp from '@noble/secp256k1';
import * as ed from '@noble/ed25519';

secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key, msg) => hmac(sha256, key, msg);
ed.hashes.sha512 = sha512;

export { sha256, sha512, hmac };

export function sha256Bytes(bytes) {
  return sha256(bytes);
}
