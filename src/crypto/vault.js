// Mã hoá private key bằng password trước khi lưu AsyncStorage.
//
// TẠI SAO TỰ VIẾT: danh sách thư viện cố định của dự án không có thư viện mã hoá
// đối xứng. expo-crypto chỉ có hàm băm, @noble/hashes không có cipher, và
// @noble/ciphers không nằm trong danh sách. Nên vault dựng bằng đúng những
// primitive đang có: PBKDF2-HMAC-SHA256 để dẫn xuất khoá, keystream sinh từ
// HMAC-SHA256 theo counter để mã hoá, và HMAC-SHA256 để xác thực.
//
// Sơ đồ (encrypt-then-MAC):
//   salt = 16 byte ngẫu nhiên
//   iv   = 16 byte ngẫu nhiên
//   kEnc‖kMac = PBKDF2-SHA256(password, salt, ITERATIONS, 64 byte)
//   keystream[i] = HMAC-SHA256(kEnc, iv ‖ counterBE32(i))
//   cipher = plaintext XOR keystream
//   tag    = HMAC-SHA256(kMac, salt ‖ iv ‖ cipher)
//
// Sai password -> kEnc/kMac khác -> tag không khớp -> báo lỗi rõ ràng thay vì
// trả ra một private key rác. Đó là lý do phải có tag: nếu chỉ XOR không kèm
// xác thực thì mọi password đều "giải mã thành công" ra chuỗi vô nghĩa.
//
// GIỚI HẠN: đây là construction tự viết cho mục đích học tập. Nó không phải AEAD
// đã được kiểm định như AES-GCM hay XChaCha20-Poly1305. Không dùng cho tiền thật.

import { sha256, hmac } from './hashes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes, bytesEqual } from './bytes.js';
import { randomBytes } from './random.js';

const VERSION = 1;
// Số vòng chốt theo phép đo trên điện thoại thật, không suy từ máy tính: @noble
// là JS thuần, Hermes không có JIT nên chậm hơn V8 vài chục lần. Mức 120000
// trước đây làm luồng JS đứng hàng chục giây và nút Tạo ví trông như bị treo.
//
// Hằng số này CHỈ dùng khi mã hoá mới. Giải mã đọc số vòng từ chính bản ghi
// vault, nên đổi số ở đây không làm hỏng ví đã tạo trước đó.
const ITERATIONS = 10000;
const SALT_LEN = 16;
const IV_LEN = 16;
const KEY_LEN = 64; // 32 byte cho mã hoá + 32 byte cho xác thực

async function deriveKeys(password, salt, iterations) {
  const material = await pbkdf2Async(sha256, utf8ToBytes(password), salt, {
    c: iterations,
    dkLen: KEY_LEN,
  });
  return { kEnc: material.slice(0, 32), kMac: material.slice(32, 64) };
}

function keystreamXor(kEnc, iv, data) {
  const out = new Uint8Array(data.length);
  const counter = new Uint8Array(4);
  for (let offset = 0; offset < data.length; offset += 32) {
    const index = offset / 32;
    counter[0] = (index >>> 24) & 0xff;
    counter[1] = (index >>> 16) & 0xff;
    counter[2] = (index >>> 8) & 0xff;
    counter[3] = index & 0xff;
    const block = hmac(sha256, kEnc, concatBytes(iv, counter));
    const end = Math.min(32, data.length - offset);
    for (let i = 0; i < end; i++) out[offset + i] = data[offset + i] ^ block[i];
  }
  return out;
}

// Trả về object JSON-serializable để lưu thẳng vào AsyncStorage.
export async function encryptPrivateKey(privateKeyHex, password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password không được để trống');
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const { kEnc, kMac } = await deriveKeys(password, salt, ITERATIONS);
  const cipher = keystreamXor(kEnc, iv, hexToBytes(privateKeyHex));
  const tag = hmac(sha256, kMac, concatBytes(salt, iv, cipher));
  return {
    v: VERSION,
    kdf: 'pbkdf2-sha256',
    iters: ITERATIONS,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    cipher: bytesToHex(cipher),
    tag: bytesToHex(tag),
  };
}

// Ném lỗi nếu password sai. KHÔNG bao giờ trả về chuỗi rác.
export async function decryptPrivateKey(vault, password) {
  if (!vault || vault.v !== VERSION) throw new Error('Dữ liệu ví không đọc được');
  const salt = hexToBytes(vault.salt);
  const iv = hexToBytes(vault.iv);
  const cipher = hexToBytes(vault.cipher);
  const { kEnc, kMac } = await deriveKeys(password, salt, vault.iters);
  const expected = hmac(sha256, kMac, concatBytes(salt, iv, cipher));
  if (!bytesEqual(expected, hexToBytes(vault.tag))) {
    throw new Error('Sai password');
  }
  return bytesToHex(keystreamXor(kEnc, iv, cipher));
}

// Kiểm password mà không cần lấy key ra — dùng cho màn đăng nhập.
export async function verifyPassword(vault, password) {
  try {
    await decryptPrivateKey(vault, password);
    return true;
  } catch {
    return false;
  }
}
