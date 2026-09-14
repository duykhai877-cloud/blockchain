// Sinh và phân tích địa chỉ.
//
// Địa chỉ = tiền tố (3 ký tự) + 40 ký tự cuối của SHA-256(public key) = 43 ký tự.
// Tiền tố nằm trong địa chỉ để node đọc được thuật toán mà KHÔNG cần tra cứu gì
// thêm — đó là thứ làm Luật 1 của tầng A kiểm được.
//
// File này không chứa `if (alg === ...)`: tiền tố lấy từ REGISTRY trong
// algorithms.js.

import { sha256 } from './hashes.js';
import { bytesToHex, hexToBytes, isHex } from './bytes.js';
import {
  ADDRESS_PREFIX_LEN,
  getAlgorithm,
  getAlgorithmByPrefix,
  requireAlgorithm,
} from './algorithms.js';

export const ADDRESS_LEN = 43;
const HASH_TAIL_LEN = 40;

// Băm public key rồi lấy 40 ký tự hex cuối. Dùng chung cho cả hai loại ví.
function hashTail(publicKeyHex) {
  return bytesToHex(sha256(hexToBytes(publicKeyHex))).slice(-HASH_TAIL_LEN);
}

// Địa chỉ suy ra từ public key. Không kiểm tra độ dài ở đây — người gọi (Luật 3)
// đã kiểm trước. Hàm này chỉ làm đúng một việc: băm và ghép tiền tố.
export function deriveAddress(algorithmId, publicKeyHex) {
  const algorithm = requireAlgorithm(algorithmId);
  return algorithm.prefix + hashTail(publicKeyHex);
}

// Dùng cho UI: cho người dùng thấy public key họ vừa gõ băm ra địa chỉ nào.
// Trả về null nếu không băm được, để phần gọi hiện đèn xám thay vì crash.
export function tryDeriveAddress(algorithmId, publicKeyHex) {
  const algorithm = getAlgorithm(algorithmId);
  if (!algorithm) return null;
  if (!isHex(publicKeyHex, algorithm.publicKeyHexLen)) return null;
  try {
    return algorithm.prefix + hashTail(publicKeyHex);
  } catch {
    return null;
  }
}

// Tách địa chỉ ra tiền tố + thuật toán. Trả về null nếu không hợp lệ.
export function parseAddress(address) {
  if (typeof address !== 'string' || address.length !== ADDRESS_LEN) return null;
  const prefix = address.slice(0, ADDRESS_PREFIX_LEN);
  const algorithm = getAlgorithmByPrefix(prefix);
  if (!algorithm) return null;
  const body = address.slice(ADDRESS_PREFIX_LEN);
  if (!isHex(body, HASH_TAIL_LEN)) return null;
  return { prefix, algorithm, algorithmId: algorithm.id, body };
}

export function isValidAddress(address) {
  return parseAddress(address) !== null;
}

// Luật 2 của tầng A: băm lại `from` phải ra đúng `fromAddr`.
// Trả về boolean thuần; phần UI muốn biết địa chỉ thật thì gọi tryDeriveAddress.
export function addressMatchesPublicKey(algorithmId, publicKeyHex, address) {
  const derived = tryDeriveAddress(algorithmId, publicKeyHex);
  return derived !== null && derived === address;
}

// Rút gọn để hiện trên màn hình: S0x7f4e91…3a2b
export function shortenAddress(address, head = 8, tail = 4) {
  if (typeof address !== 'string' || address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
