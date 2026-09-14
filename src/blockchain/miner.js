// Đào block — Proof-of-Work.

import { COINBASE_REWARD, MAX_TX_PER_BLOCK, TX_COINBASE, TX_FAUCET } from './constants.js';
import { latestBlock } from './chain.js';
import { randomNonce } from '../crypto/random.js';
import {
  balanceOnChain,
  collectFaucetClaims,
  collectSpentNonces,
  hashBlock,
  meetsDifficulty,
  verifyTxAuth,
} from './validate.js';

// Số nonce thử giữa hai lần nhả luồng. Vòng đào chạy trên luồng JS của UI nên
// phải trả quyền điều khiển lại định kỳ, nếu không màn hình đứng hình.
const YIELD_EVERY = 500;

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

export function buildCoinbase(minerAddress, timestamp) {
  return {
    type: TX_COINBASE,
    to: minerAddress,
    amount: COINBASE_REWARD,
    timestamp,
    // Nonce ngẫu nhiên để hai coinbase cùng địa chỉ, cùng mốc thời gian vẫn ra
    // hai block khác hash.
    nonce: randomNonce(),
  };
}

// Chọn giao dịch từ mempool để đóng gói. Duyệt tuần tự và cộng dồn số đã tiêu,
// đúng cách mà validateBlock sẽ kiểm lại — nếu chọn kiểu khác thì block đào ra
// tự mình cũng không qua nổi luật của chính mình.
export async function selectTransactions(mempool, chain) {
  const limit = MAX_TX_PER_BLOCK - 1; // chừa một chỗ cho coinbase
  const spending = new Map();
  const faucetClaims = collectFaucetClaims(chain);
  const spentNonces = collectSpentNonces(chain);
  const chosen = [];

  for (const tx of mempool) {
    if (chosen.length >= limit) break;

    const auth = await verifyTxAuth(tx);
    if (!auth.ok) continue;

    const key = `${tx.fromAddr}|${tx.nonce}`;
    if (spentNonces.has(key)) continue;

    if (tx.type === TX_FAUCET) {
      if (faucetClaims.has(tx.fromAddr)) continue;
      faucetClaims.set(tx.fromAddr, -1);
      spentNonces.add(key);
      chosen.push(tx);
      continue;
    }

    const alreadySpending = spending.get(tx.fromAddr) || 0;
    if (balanceOnChain(chain, tx.fromAddr) - alreadySpending < tx.amount) continue;
    spending.set(tx.fromAddr, alreadySpending + tx.amount);
    spentNonces.add(key);
    chosen.push(tx);
  }

  return chosen;
}

// Đào một block.
//
// `shouldContinue` được gọi mỗi lần nhả luồng. Trả về false là dừng ngay và trả
// null — đây là đường thoát khi người dùng đăng xuất hoặc khi có block mới từ
// mạng. Không có nó thì vòng đào cũ chạy tiếp và đúc coinbase cho account mới.
export async function mineBlock({ chain, mempool, minerAddress, shouldContinue, onProgress }) {
  const previous = latestBlock(chain);
  const timestamp = Date.now();
  const transactions = [
    buildCoinbase(minerAddress, timestamp),
    ...(await selectTransactions(mempool, chain)),
  ];

  const candidate = {
    index: previous.index + 1,
    previousHash: previous.hash,
    timestamp,
    miner: minerAddress,
    transactions,
    nonce: 0,
  };

  let attempts = 0;
  for (let nonce = 0; ; nonce++) {
    candidate.nonce = nonce;
    const hash = hashBlock(candidate);
    attempts++;

    if (meetsDifficulty(hash)) {
      return { ...candidate, hash };
    }

    if (attempts % YIELD_EVERY === 0) {
      await yieldToUi();
      if (shouldContinue && !shouldContinue()) return null;
      if (onProgress) onProgress(attempts);
    }
  }
}
