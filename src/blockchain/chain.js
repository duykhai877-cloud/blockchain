// Cấu trúc chuỗi, block gốc, luật chọn chuỗi và kho block mồ côi.

import {
  COINBASE_REWARD,
  GENESIS_PREVIOUS_HASH,
  GENESIS_TIMESTAMP,
  TX_COINBASE,
} from './constants.js';
import { hashBlock, meetsDifficulty, validateChain } from './validate.js';

// Địa chỉ đốt của block gốc: không ai có private key băm ra 40 số 0, nên 50 coin
// thưởng của genesis vĩnh viễn không tiêu được.
export const GENESIS_MINER = 'S0x' + '0'.repeat(40);

// Nonce của genesis được đào sẵn một lần và ghi cứng ở đây.
// TẠI SAO PHẢI GHI CỨNG: block gốc cũng phải qua đủ luật validate như mọi block
// khác, kể cả luật độ khó. Nếu để mỗi máy tự đào genesis thì nonce khác nhau,
// hash khác nhau, previousHash của block #1 khác nhau, và hai máy không bao giờ
// nối được chuỗi với nhau. Cùng lý do đó, timestamp cũng ghi cứng chứ không
// dùng Date.now().
// Hash tương ứng: 0002fbe4c2019cd2ab50a03ce458da5125f022579e8d02bbbc34d61f50dc72c7
const GENESIS_NONCE = 11041;

export function createGenesisBlock() {
  const block = {
    index: 0,
    previousHash: GENESIS_PREVIOUS_HASH,
    timestamp: GENESIS_TIMESTAMP,
    miner: GENESIS_MINER,
    transactions: [
      {
        type: TX_COINBASE,
        to: GENESIS_MINER,
        amount: COINBASE_REWARD,
        timestamp: GENESIS_TIMESTAMP,
        nonce: 'genesis',
      },
    ],
    nonce: GENESIS_NONCE,
  };
  block.hash = hashBlock(block);
  return block;
}

export function createChain() {
  return [createGenesisBlock()];
}

export function latestBlock(chain) {
  return chain[chain.length - 1];
}

export function chainHeight(chain) {
  return chain.length;
}

// LUẬT CHUỖI DÀI NHẤT — chỉ áp dụng GIỮA CÁC CHUỖI HỢP LỆ.
// Chuỗi dài hơn nhưng chứa block sai luật thì KHÔNG được theo. Sức mạnh đào không
// mua được tính hợp lệ. Vì vậy hàm này validate TRƯỚC rồi mới so chiều dài, và
// không bao giờ đảo thứ tự hai bước đó.
export async function chooseChain(currentChain, candidateChain) {
  if (!Array.isArray(candidateChain) || candidateChain.length <= currentChain.length) {
    return { replace: false, reason: 'not-longer' };
  }
  if (candidateChain[0].hash !== currentChain[0].hash) {
    return { replace: false, reason: 'genesis-mismatch' };
  }
  const result = await validateChain(candidateChain);
  if (!result.ok) {
    return { replace: false, reason: 'invalid', detail: result.detail };
  }
  return { replace: true, reason: 'longer-and-valid' };
}

// Điểm rẽ nhánh giữa hai chuỗi — dùng để biết những giao dịch nào bị bật ra khỏi
// chuỗi sau reorg và cần đưa lại vào mempool.
export function findForkPoint(oldChain, newChain) {
  let i = 0;
  while (i < oldChain.length && i < newChain.length && oldChain[i].hash === newChain[i].hash) {
    i++;
  }
  return i;
}

// Giao dịch có chữ ký nằm trong phần chuỗi cũ bị loại bỏ. Coinbase không lấy lại
// vì nó gắn với block đã mất hiệu lực.
export function droppedTransactions(oldChain, forkIndex) {
  const dropped = [];
  for (let i = forkIndex; i < oldChain.length; i++) {
    for (const tx of oldChain[i].transactions) {
      if (tx.type !== TX_COINBASE) dropped.push(tx);
    }
  }
  return dropped;
}

export function isBlockSealed(block) {
  return meetsDifficulty(block.hash) && hashBlock(block) === block.hash;
}

// Kho block mồ côi — block nhận được nhưng chưa có block cha.
// CHỈ GIỮ TRONG RAM, không lưu đĩa: chúng chưa được kiểm hết luật nên không đáng
// tin, và mất đi cũng không sao vì node sẽ xin lại chuỗi từ mạng.
export function createOrphanPool(limit = 50) {
  const byPreviousHash = new Map();
  let count = 0;

  return {
    add(block) {
      if (count >= limit) return false;
      const list = byPreviousHash.get(block.previousHash) || [];
      if (list.some((b) => b.hash === block.hash)) return false;
      list.push(block);
      byPreviousHash.set(block.previousHash, list);
      count++;
      return true;
    },
    // Lấy các block mồ côi nối được vào hash vừa xuất hiện.
    take(hash) {
      const list = byPreviousHash.get(hash);
      if (!list) return [];
      byPreviousHash.delete(hash);
      count -= list.length;
      return list;
    },
    size() {
      return count;
    },
    clear() {
      byPreviousHash.clear();
      count = 0;
    },
  };
}
