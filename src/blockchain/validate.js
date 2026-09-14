// BỐN TẦNG PHÒNG THỦ — phần cốt lõi của dự án.
//
// Bốn tầng khác nhau và KHÔNG thay thế nhau được:
//   Tầng A — ba luật danh tính, chạy TRƯỚC khi verify chữ ký
//   Tầng B — verify chữ ký, dispatch theo sigAlg
//   Tầng C — số dư và double-spend
//   Tầng D — luật coinbase
//
// Cả bốn tầng chạy ở CẢ HAI nơi: khi nhận giao dịch vào mempool, VÀ khi validate
// block nhận từ mạng. Zero-trust — node nhận không tin gì ở node gửi.
//
// MODEL SỐ DƯ: account/balance kiểu Ethereum, KHÔNG phải UTXO. Số dư của một địa
// chỉ được tính bằng cách duyệt toàn chuỗi và cộng trừ. Chọn model này vì nó cho
// phép viết luật số dư ngắn và đọc được, còn UTXO sẽ kéo theo quản lý tập đầu ra
// chưa tiêu — nhiều code mà không thêm gì cho mục tiêu so sánh chữ ký của dự án.

import { sha256 } from '../crypto/hashes.js';
import { utf8ToBytes, bytesToHex } from '../crypto/bytes.js';
import {
  getAlgorithm,
  isPublicKeyLengthValid,
  signDigest,
  verifyDigest,
} from '../crypto/algorithms.js';
import { parseAddress, tryDeriveAddress, isValidAddress } from '../crypto/address.js';
import {
  COINBASE_REWARD,
  DIFFICULTY_PREFIX,
  FAUCET_AMOUNT,
  GENESIS_PREVIOUS_HASH,
  TX_COINBASE,
  TX_FAUCET,
  TX_TRANSFER,
} from './constants.js';

const SIGNED_TYPES = [TX_TRANSFER, TX_FAUCET];

// ---------------------------------------------------------------------------
// SERIALIZE — MỘT hàm duy nhất, dùng chung ở mọi nơi
// ---------------------------------------------------------------------------

// Đây là hàm sinh ra chuỗi được ký. Dùng chung lúc ký, lúc verify, lúc hiển thị
// cho người dùng xem. Lệch một dấu cách là chữ ký fail và cực khó lần ra, nên
// tuyệt đối không viết bản sao thứ hai của hàm này ở bất kỳ đâu.
export function serializePayload(tx) {
  return JSON.stringify({
    type: tx.type,
    from: tx.from,
    fromAddr: tx.fromAddr,
    to: tx.to,
    amount: tx.amount,
    timestamp: tx.timestamp,
    nonce: tx.nonce,
  });
}

export function hashPayload(tx) {
  return sha256(utf8ToBytes(serializePayload(tx)));
}

export function hashPayloadHex(tx) {
  return bytesToHex(hashPayload(tx));
}

// Chuẩn hoá thứ tự khoá trước khi băm block. Nếu băm thẳng object nhận từ mạng
// thì thứ tự khoá do phía gửi quyết định, và cùng một nội dung có thể ra hai
// hash khác nhau.
function canonicalTx(tx) {
  if (tx.type === TX_COINBASE) {
    return { type: tx.type, to: tx.to, amount: tx.amount, timestamp: tx.timestamp, nonce: tx.nonce };
  }
  return {
    type: tx.type,
    from: tx.from,
    fromAddr: tx.fromAddr,
    to: tx.to,
    amount: tx.amount,
    timestamp: tx.timestamp,
    nonce: tx.nonce,
    sigAlg: tx.sigAlg,
    signature: tx.signature,
  };
}

export function serializeBlock(block) {
  return JSON.stringify({
    index: block.index,
    previousHash: block.previousHash,
    timestamp: block.timestamp,
    miner: block.miner,
    transactions: (block.transactions || []).map(canonicalTx),
    nonce: block.nonce,
  });
}

export function hashBlock(block) {
  return bytesToHex(sha256(utf8ToBytes(serializeBlock(block))));
}

export function meetsDifficulty(hash) {
  return typeof hash === 'string' && hash.startsWith(DIFFICULTY_PREFIX);
}

// ---------------------------------------------------------------------------
// KÝ
// ---------------------------------------------------------------------------

// Dựng giao dịch chuyển coin.
//
// ĐIỂM SỐNG CÒN: `fromAddr` và `from` là HAI THAM SỐ ĐỘC LẬP và hàm này không suy
// ra cái nọ từ cái kia. Màn Chuyển coin truyền fromAddr lấy từ session ví đang
// đăng nhập, còn `from` là đúng chuỗi người dùng gõ vào ô public key. Nếu ở đâu
// đó viết `fromAddr = deriveAddress(from)` thì hai vế của Luật 2 cùng đến từ một
// nguồn, gõ sai gì cũng "hợp lệ", và toàn bộ phần demo mất ý nghĩa.
export function buildTransfer({ from, fromAddr, to, amount, sigAlg, timestamp, nonce }) {
  return { type: TX_TRANSFER, from, fromAddr, to, amount, timestamp, nonce, sigAlg };
}

// Faucet: to luôn bằng fromAddr — chỉ tự nhận cho chính mình, không nhận hộ ai.
// Nếu cho nhận hộ thì kẻ tấn công phát faucet tới địa chỉ người khác và đốt mất
// suất nhận duy nhất của họ.
export function buildFaucet({ from, fromAddr, sigAlg, timestamp, nonce }) {
  return {
    type: TX_FAUCET,
    from,
    fromAddr,
    to: fromAddr,
    amount: FAUCET_AMOUNT,
    timestamp,
    nonce,
    sigAlg,
  };
}

// Ký giao dịch. Lưu ý: hàm này KHÔNG tự suy ra `from` hay `fromAddr` — người gọi
// phải truyền vào. Đó là chủ ý: màn Chuyển coin lấy fromAddr từ session ví đang
// đăng nhập còn `from` là đúng chuỗi người dùng gõ, nhờ vậy Luật 2 mới có hai vế
// độc lập để đối chiếu.
export async function signTx(tx, privateKeyHex, options) {
  const { signature, recovery } = await signDigest(
    tx.sigAlg,
    hashPayload(tx),
    privateKeyHex,
    options
  );
  return { ...tx, signature, recovery };
}

// ---------------------------------------------------------------------------
// TẦNG A — ba luật danh tính (chạy TRƯỚC khi verify chữ ký)
// ---------------------------------------------------------------------------

const ok = () => ({ ok: true });
const bad = (rule, detail) => ({ ok: false, rule, detail });

// THỨ TỰ BẮT BUỘC: Luật 1 -> Luật 3 -> Luật 2.
// Nếu để Luật 2 trước Luật 3 thì khi người dùng dán nhầm public key ví E vào ví S,
// thông báo sẽ là "băm không khớp" — đúng nhưng lạc hướng. Báo "sai độ dài" mới
// chỉ đúng vấn đề.
export function checkIdentityRules(tx) {
  if (!tx || typeof tx !== 'object') return bad('format', 'Giao dịch rỗng');
  if (!SIGNED_TYPES.includes(tx.type)) {
    return bad('format', `Loại giao dịch không ký được: ${String(tx.type)}`);
  }
  if (typeof tx.from !== 'string' || typeof tx.fromAddr !== 'string') {
    return bad('format', 'Thiếu trường from hoặc fromAddr');
  }

  const parsed = parseAddress(tx.fromAddr);
  if (!parsed) {
    return bad(1, `Địa chỉ gửi không hợp lệ: ${String(tx.fromAddr)}`);
  }

  // sigAlg là chuỗi lạ -> reject, KHÔNG bỏ qua.
  const declared = getAlgorithm(tx.sigAlg);
  if (!declared) {
    return bad(1, `Thuật toán chữ ký không được hỗ trợ: ${String(tx.sigAlg)}`);
  }

  // LUẬT 1 — sigAlg phải khớp tiền tố địa chỉ.
  // Thiếu luật này, kẻ tấn công khai báo thuật toán khác để né hàm verify đúng.
  if (declared.id !== parsed.algorithmId) {
    return bad(
      1,
      `Địa chỉ ${parsed.prefix} phải dùng ${parsed.algorithm.name}, giao dịch khai ${declared.name}`
    );
  }

  // LUẬT 3 — độ dài public key phải khớp thuật toán. Sai thì reject ngay,
  // KHÔNG gọi verify.
  if (!isPublicKeyLengthValid(declared.id, tx.from)) {
    return bad(
      3,
      `${declared.name} cần public key ${declared.publicKeyHexLen} hex (${declared.publicKeyBytes} byte), nhận được ${tx.from.length}`
    );
  }

  // LUẬT 2 — băm lại `from` phải ra đúng `fromAddr`.
  // Thiếu luật này, kẻ tấn công ký bằng khóa của mình nhưng gắn địa chỉ của người
  // giàu vào fromAddr — chữ ký vẫn hợp lệ 100%, tiền bị trừ của nạn nhân.
  const derived = tryDeriveAddress(declared.id, tx.from);
  if (derived !== tx.fromAddr) {
    return bad(
      2,
      `Public key băm ra ${String(derived)} nhưng địa chỉ gửi là ${tx.fromAddr}`
    );
  }

  return ok();
}

// Kiểm các trường số và địa chỉ nhận. Không thuộc tầng nào trong bốn tầng nhưng
// phải chạy trước, vì amount âm hoặc không nguyên sẽ phá mọi phép tính số dư.
function checkAmountAndRecipient(tx) {
  if (!Number.isInteger(tx.amount) || tx.amount <= 0) {
    return bad('format', 'Số coin phải là số nguyên dương');
  }
  if (!Number.isInteger(tx.timestamp) || tx.timestamp <= 0) {
    return bad('format', 'Timestamp không hợp lệ');
  }
  if (typeof tx.nonce !== 'string' || tx.nonce.length === 0) {
    return bad('format', 'Thiếu nonce');
  }
  // Coin gửi vào địa chỉ không tồn tại là mất vĩnh viễn, nên chặn cứng ở đây.
  if (!isValidAddress(tx.to)) {
    return bad('format', `Địa chỉ nhận không hợp lệ: ${String(tx.to)}`);
  }
  return ok();
}

// Luật riêng của FAUCET.
// Faucet sinh tiền từ hư không giống coinbase nên KHÔNG áp kiểm số dư, nhưng
// phải có luật riêng, nếu không thì:
//   - không ký  -> ai cũng phát faucet tới địa chỉ người khác, đốt mất suất nhận
//                  của nạn nhân vì luật chống nhận lặp chỉ cho mỗi địa chỉ một lần
//   - to != from -> nhận hộ người khác, cũng đốt suất của họ
//   - amount tự đặt -> tự in tiền
function checkFaucetRules(tx) {
  if (tx.to !== tx.fromAddr) {
    return bad('faucet', 'Faucet chỉ được tự nhận cho chính mình (to phải bằng fromAddr)');
  }
  if (tx.amount !== FAUCET_AMOUNT) {
    return bad('faucet', `Faucet phải đúng ${FAUCET_AMOUNT} coin, giao dịch ghi ${tx.amount}`);
  }
  return ok();
}

// ---------------------------------------------------------------------------
// TẦNG A + B — danh tính và chữ ký. Chưa động tới số dư.
// ---------------------------------------------------------------------------

// verifyTx trả về LÝ DO, không chỉ boolean.
//   { ok: true } | { ok: false, rule, detail }
// `rule` và `detail` CHỈ dùng cho UI hiển thị thông báo.
// Phần consensus chỉ đọc trường `ok`.
export async function verifyTxAuth(tx) {
  const identity = checkIdentityRules(tx);
  if (!identity.ok) return identity;

  const fields = checkAmountAndRecipient(tx);
  if (!fields.ok) return fields;

  if (tx.type === TX_FAUCET) {
    const faucet = checkFaucetRules(tx);
    if (!faucet.ok) return faucet;
  }

  // TẦNG B — chữ ký. Dispatch theo sigAlg, gọi verify tương ứng.
  if (typeof tx.signature !== 'string' || tx.signature.length === 0) {
    return bad('sig', 'Giao dịch không có chữ ký');
  }
  const valid = await verifyDigest(tx.sigAlg, tx.signature, hashPayload(tx), tx.from);
  if (!valid) return bad('sig', 'Chữ ký không hợp lệ');

  return ok();
}

// ---------------------------------------------------------------------------
// TẦNG C — số dư
// ---------------------------------------------------------------------------

// Cộng trừ theo ĐỊA CHỈ, không theo public key — người nhận không có public key
// trong giao dịch.
export function balanceOnChain(chain, addr) {
  let bal = 0;
  for (const block of chain) {
    for (const tx of block.transactions) {
      if (tx.type === TX_COINBASE && tx.to === addr) bal += tx.amount;
      if (tx.type === TX_FAUCET && tx.to === addr) bal += tx.amount;
      if (tx.type === TX_TRANSFER) {
        if (tx.to === addr) bal += tx.amount;
        if (tx.fromAddr === addr) bal -= tx.amount;
      }
    }
  }
  return bal;
}

// Bảng số dư của toàn chuỗi. Cùng luật với balanceOnChain nhưng duyệt một lần
// cho mọi địa chỉ — dùng khi validate block, nơi phải tra số dư liên tục.
export function buildBalanceTable(chain) {
  const table = new Map();
  const credit = (addr, amount) => table.set(addr, (table.get(addr) || 0) + amount);
  for (const block of chain) {
    for (const tx of block.transactions) {
      if (tx.type === TX_COINBASE || tx.type === TX_FAUCET) {
        credit(tx.to, tx.amount);
      } else if (tx.type === TX_TRANSFER) {
        credit(tx.to, tx.amount);
        credit(tx.fromAddr, -tx.amount);
      }
    }
  }
  return table;
}

// Địa chỉ nào đã nhận faucet, và ở block nào. Luật chống nhận lặp đối chiếu theo
// fromAddr để node khác kiểm được, không phải cờ cục bộ.
export function collectFaucetClaims(chain) {
  const claims = new Map();
  for (const block of chain) {
    for (const tx of block.transactions) {
      if (tx.type === TX_FAUCET && !claims.has(tx.fromAddr)) {
        claims.set(tx.fromAddr, block.index);
      }
    }
  }
  return claims;
}

// Chống phát lại: cùng một giao dịch đã ký không được vào chuỗi hai lần.
// Không có luật này thì bất kỳ ai bắt được gói tin cũng phát lại được và ví
// người gửi bị trừ nhiều lần từ một chữ ký duy nhất.
export function collectSpentNonces(chain) {
  const seen = new Set();
  for (const block of chain) {
    for (const tx of block.transactions) {
      if (tx.type !== TX_COINBASE) seen.add(`${tx.fromAddr}|${tx.nonce}`);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// TẦNG D + validate block
// ---------------------------------------------------------------------------

const blockOk = () => ({ ok: true });
const blockBad = (reason, detail) => ({ ok: false, reason, detail });

// Validate một block đứng sau previousBlock, với chainBefore là toàn bộ chuỗi
// TRƯỚC block đang xét (không bao gồm nó).
//
// TUYỆT ĐỐI KHÔNG dùng mempool của mình để kiểm block của người khác. Bảng số dư
// dựng từ chain rồi cập nhật TUẦN TỰ sau mỗi tx — duyệt tuần tự chính là thứ bắt
// được double-spend nằm trong cùng một block.
export async function validateBlock(block, previousBlock, chainBefore) {
  if (!block || typeof block !== 'object') return blockBad('format', 'Block rỗng');
  if (!Array.isArray(block.transactions)) return blockBad('format', 'Block thiếu danh sách giao dịch');
  if (!Number.isInteger(block.index) || block.index < 0) {
    return blockBad('format', 'Chỉ số block không hợp lệ');
  }

  if (previousBlock) {
    if (block.index !== previousBlock.index + 1) {
      return blockBad('index', `Block #${block.index} không nối tiếp #${previousBlock.index}`);
    }
    // previousHash phải trỏ đúng vào block trước.
    if (block.previousHash !== previousBlock.hash) {
      return blockBad('link', 'previousHash không trỏ đúng block trước');
    }
  } else if (block.previousHash !== GENESIS_PREVIOUS_HASH) {
    return blockBad('link', 'Block gốc phải có previousHash toàn số 0');
  }

  // Hash tính lại từ nội dung block phải khớp hash ghi trong block.
  const recomputed = hashBlock(block);
  if (recomputed !== block.hash) {
    return blockBad('hash', 'Hash ghi trong block không khớp nội dung');
  }
  // Hash phải đạt đủ difficulty.
  if (!meetsDifficulty(block.hash)) {
    return blockBad('pow', `Hash không đạt độ khó (cần ${DIFFICULTY_PREFIX}…)`);
  }

  // ---- TẦNG D — luật coinbase ----
  // Coinbase sinh tiền từ hư không nên không áp kiểm số dư. Nhưng phải có luật
  // riêng, nếu không thợ đào tự chèn giao dịch thưởng 1 tỷ coin cho chính nó.
  const coinbases = block.transactions.filter((tx) => tx && tx.type === TX_COINBASE);
  if (coinbases.length !== 1) {
    return blockBad('coinbase', `Block phải có đúng 1 coinbase, đang có ${coinbases.length}`);
  }
  const coinbase = coinbases[0];
  if (coinbase.amount !== COINBASE_REWARD) {
    return blockBad('coinbase', `Thưởng đào phải đúng ${COINBASE_REWARD}, block ghi ${coinbase.amount}`);
  }
  if (!isValidAddress(coinbase.to)) {
    return blockBad('coinbase', 'Địa chỉ nhận thưởng đào không hợp lệ');
  }
  // Coinbase không có chữ ký và không có fromAddr.
  if (coinbase.signature || coinbase.fromAddr) {
    return blockBad('coinbase', 'Coinbase không được có chữ ký hoặc fromAddr');
  }

  // ---- Duyệt tuần tự, cập nhật bảng số dư sau mỗi tx ----
  const balances = buildBalanceTable(chainBefore);
  const faucetClaims = collectFaucetClaims(chainBefore);
  const spentNonces = collectSpentNonces(chainBefore);
  const balanceOf = (addr) => balances.get(addr) || 0;
  const credit = (addr, amount) => balances.set(addr, balanceOf(addr) + amount);

  for (const tx of block.transactions) {
    if (!tx || typeof tx !== 'object') return blockBad('format', 'Giao dịch rỗng trong block');

    if (tx.type === TX_COINBASE) {
      credit(tx.to, tx.amount);
      continue;
    }

    // Tầng A + B cho mọi giao dịch có chữ ký. Một tx vi phạm là reject CẢ BLOCK.
    const auth = await verifyTxAuth(tx);
    if (!auth.ok) {
      return blockBad('tx', `Giao dịch bị từ chối (luật ${auth.rule}): ${auth.detail}`);
    }

    const nonceKey = `${tx.fromAddr}|${tx.nonce}`;
    if (spentNonces.has(nonceKey)) {
      return blockBad('replay', 'Block chứa giao dịch đã có trên chuỗi');
    }
    spentNonces.add(nonceKey);

    if (tx.type === TX_FAUCET) {
      // Luật chống nhận lặp: quét chain (không tính block đang xét) + duyệt tuần
      // tự trong block. Hai FAUCET cùng địa chỉ trong một block -> reject cả block.
      if (faucetClaims.has(tx.fromAddr)) {
        return blockBad('faucet', `Địa chỉ ${tx.fromAddr} đã nhận faucet rồi`);
      }
      faucetClaims.set(tx.fromAddr, block.index);
      // Khác coinbase: một block ĐƯỢC PHÉP chứa nhiều FAUCET, miễn khác địa chỉ.
      credit(tx.to, tx.amount);
      continue;
    }

    // ---- TẦNG C — số dư. Chữ ký hợp lệ KHÔNG có nghĩa là có tiền. ----
    if (balanceOf(tx.fromAddr) < tx.amount) {
      return blockBad(
        'balance',
        `${tx.fromAddr} chỉ có ${balanceOf(tx.fromAddr)} coin, cần ${tx.amount}`
      );
    }
    credit(tx.fromAddr, -tx.amount);
    credit(tx.to, tx.amount);
  }

  return blockOk();
}

// Validate toàn chuỗi từ block gốc. Dùng khi nhận một chuỗi lạ từ mạng.
//
// LUẬT CHUỖI DÀI NHẤT chỉ áp dụng GIỮA CÁC CHUỖI HỢP LỆ. Chuỗi dài hơn nhưng
// chứa block sai luật thì KHÔNG được theo. Sức mạnh đào không mua được tính hợp
// lệ — đó là lý do hàm này phải chạy trọn vẹn trước khi so sánh chiều dài.
export async function validateChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return { ok: false, reason: 'format', detail: 'Chuỗi rỗng' };
  }
  for (let i = 0; i < chain.length; i++) {
    const result = await validateBlock(chain[i], i === 0 ? null : chain[i - 1], chain.slice(0, i));
    if (!result.ok) {
      return { ...result, detail: `Block #${i}: ${result.detail}` };
    }
  }
  return { ok: true, height: chain.length };
}
