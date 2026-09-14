// ĐIỂM DISPATCH DUY NHẤT của toàn dự án.
//
// NGUYÊN TẮC: không nơi nào khác trong code được viết `if (alg === 'secp256k1')`.
// Muốn thêm thuật toán thứ ba (ví dụ ML-DSA hậu lượng tử) thì chỉ cần thêm một
// file trong src/crypto/ và thêm một mục vào REGISTRY bên dưới — tầng blockchain
// và toàn bộ màn hình không phải sửa một dòng nào.
//
// Mỗi mục trong REGISTRY vừa mô tả thuật toán (dùng cho UI) vừa cung cấp các
// hàm thao tác khoá và chữ ký (dùng cho consensus).

import * as secp256k1 from './secp256k1.js';
import * as ed25519 from './ed25519.js';

export const ALG_SECP256K1 = 'secp256k1';
export const ALG_ED25519 = 'ed25519';

const REGISTRY = {
  [ALG_SECP256K1]: {
    id: ALG_SECP256K1,
    letter: 'S',
    prefix: 'S0x',
    name: 'secp256k1',
    fullName: 'secp256k1 (ECDSA)',
    color: '#f0883e', // cam
    usedBy: 'Bitcoin, Ethereum',
    privateKeyBytes: 32,
    publicKeyBytes: secp256k1.PUBLIC_KEY_BYTES,
    publicKeyHexLen: secp256k1.PUBLIC_KEY_HEX_LEN,
    publicKeyNote: 'dạng nén',
    signatureFormat: 'DER',
    signatureBytesLabel: '70–72 byte',
    typicalSignatureBytes: 71,
    // secp256k1 tính ngược được public key từ chữ ký; Ed25519 thì không.
    supportsRecovery: true,
    // ECDSA CÓ THỂ tất định (RFC 6979) hoặc ngẫu nhiên, tuỳ lập trình viên.
    supportsExtraEntropy: true,
    // Cờ này nói về THƯ VIỆN đang cài, không phải về thuật toán. ECDSA không có
    // batch verify; Ed25519 thì có trên lý thuyết nhưng @noble không hiện API.
    supportsBatchVerify: false,
    privateKeyRule:
      'Phải khác 0 và nhỏ hơn bậc n của đường cong. Một số chuỗi 64 hex sẽ bị từ chối.',
    ...secp256k1,
  },
  [ALG_ED25519]: {
    id: ALG_ED25519,
    letter: 'E',
    prefix: 'E0x',
    name: 'Ed25519',
    fullName: 'Ed25519 (EdDSA)',
    color: '#a371f7', // tím
    usedBy: 'Solana, Cardano',
    privateKeyBytes: 32,
    publicKeyBytes: ed25519.PUBLIC_KEY_BYTES,
    publicKeyHexLen: ed25519.PUBLIC_KEY_HEX_LEN,
    publicKeyNote: 'raw',
    signatureFormat: 'raw',
    signatureBytesLabel: '64 byte',
    typicalSignatureBytes: 64,
    supportsRecovery: false,
    // Ed25519 tất định BẮT BUỘC theo RFC 8032 — không có chế độ nào đổi được.
    supportsExtraEntropy: false,
    // @noble/ed25519 v3.1.0 chỉ xuất verify/verifyAsync cho MỘT chữ ký. Lợi thế
    // xác minh theo lô của Ed25519 vì vậy không đo được bằng thư viện này.
    supportsBatchVerify: false,
    privateKeyRule: 'Mọi chuỗi 64 hex đều hợp lệ vì Ed25519 băm khoá trước khi dùng.',
    ...ed25519,
  },
};

export const ALGORITHM_IDS = Object.keys(REGISTRY);

export function listAlgorithms() {
  return ALGORITHM_IDS.map((id) => REGISTRY[id]);
}

export function isKnownAlgorithm(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(REGISTRY, id);
}

// Trả về mô tả thuật toán, hoặc null nếu id lạ.
// Phần consensus PHẢI kiểm null và từ chối — sigAlg lạ không được bỏ qua.
export function getAlgorithm(id) {
  return isKnownAlgorithm(id) ? REGISTRY[id] : null;
}

// Bắt buộc phải có — dùng ở chỗ đã chắc chắn id hợp lệ.
export function requireAlgorithm(id) {
  const algorithm = getAlgorithm(id);
  if (!algorithm) throw new Error(`Thuật toán không được hỗ trợ: ${String(id)}`);
  return algorithm;
}

const BY_PREFIX = {};
for (const id of ALGORITHM_IDS) BY_PREFIX[REGISTRY[id].prefix] = REGISTRY[id];

export const ADDRESS_PREFIXES = Object.keys(BY_PREFIX);
export const ADDRESS_PREFIX_LEN = 3;

export function getAlgorithmByPrefix(prefix) {
  return Object.prototype.hasOwnProperty.call(BY_PREFIX, prefix) ? BY_PREFIX[prefix] : null;
}

// ---- Các hàm dispatch dùng chung ----

export async function generatePrivateKeyHex(algorithmId) {
  return requireAlgorithm(algorithmId).generatePrivateKeyHex();
}

export function isValidPrivateKeyHex(algorithmId, privateKeyHex) {
  const algorithm = getAlgorithm(algorithmId);
  return algorithm ? algorithm.isValidPrivateKeyHex(privateKeyHex) : false;
}

export async function getPublicKeyHex(algorithmId, privateKeyHex) {
  return requireAlgorithm(algorithmId).getPublicKeyHex(privateKeyHex);
}

export async function signDigest(algorithmId, digest, privateKeyHex, options) {
  return requireAlgorithm(algorithmId).sign(digest, privateKeyHex, options);
}

// Trả về false (không ném lỗi) với mọi đầu vào hỏng — phần consensus cần một
// câu trả lời dứt khoát chứ không phải exception.
export async function verifyDigest(algorithmId, signatureHex, digest, publicKeyHex) {
  const algorithm = getAlgorithm(algorithmId);
  if (!algorithm) return false;
  return algorithm.verify(signatureHex, digest, publicKeyHex);
}

export async function recoverPublicKeyHex(algorithmId, signatureHex, digest, recovery) {
  const algorithm = requireAlgorithm(algorithmId);
  if (!algorithm.supportsRecovery) {
    throw new Error(`${algorithm.name} không hỗ trợ khôi phục public key từ chữ ký`);
  }
  return algorithm.recoverPublicKeyHex(signatureHex, digest, recovery);
}

// Luật 3 của tầng A: độ dài public key phải khớp thuật toán.
export function isPublicKeyLengthValid(algorithmId, publicKeyHex) {
  const algorithm = getAlgorithm(algorithmId);
  if (!algorithm) return false;
  return typeof publicKeyHex === 'string' && publicKeyHex.length === algorithm.publicKeyHexLen;
}
