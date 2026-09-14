// Mempool — hàng chờ giao dịch chưa vào block.
//
// Mọi hàm ở đây là hàm thuần: nhận mảng, trả mảng mới. Node giữ mảng, mempool
// không giữ trạng thái riêng. Nhờ vậy khi reorg chỉ cần quét lại một lượt.

import { TX_COINBASE, TX_FAUCET, TX_TRANSFER } from './constants.js';
import { balanceOnChain, collectFaucetClaims, collectSpentNonces, verifyTxAuth } from './validate.js';

export function createMempool() {
  return [];
}

export function txKey(tx) {
  return `${tx.fromAddr}|${tx.nonce}`;
}

// Tổng số coin đang bị giữ bởi các giao dịch chờ của cùng một địa chỉ.
// Faucet không tính vào đây vì nó không tiêu tiền của ai.
export function pendingSpend(mempool, addr) {
  let total = 0;
  for (const tx of mempool) {
    if (tx.type === TX_TRANSFER && tx.fromAddr === addr) total += tx.amount;
  }
  return total;
}

export function hasPendingFaucet(mempool, addr) {
  return mempool.some((tx) => tx.type === TX_FAUCET && tx.fromAddr === addr);
}

// Số dư khả dụng = số dư đã xác nhận trên chuỗi − tổng đang chờ trong mempool.
// THIẾU PHẦN TRỪ PENDING thì A ký 3 giao dịch 50 coin liên tiếp và cả 3 đều
// "hợp lệ" khi xét riêng lẻ.
export function availableBalance(chain, mempool, addr) {
  return balanceOnChain(chain, addr) - pendingSpend(mempool, addr);
}

// Đưa một giao dịch vào mempool. Chạy đủ tầng A, B, C — không tin gì ở phía gửi,
// kể cả khi giao dịch do chính máy này vừa ký.
export async function addTransaction(mempool, tx, chain) {
  const auth = await verifyTxAuth(tx);
  if (!auth.ok) return { ...auth, mempool };

  const key = txKey(tx);
  if (mempool.some((existing) => txKey(existing) === key)) {
    return { ok: false, rule: 'duplicate', detail: 'Giao dịch đã có trong mempool', mempool };
  }
  if (collectSpentNonces(chain).has(key)) {
    return { ok: false, rule: 'duplicate', detail: 'Giao dịch đã có trên chuỗi', mempool };
  }

  if (tx.type === TX_FAUCET) {
    // Luật chống nhận lặp kiểm ở CẢ HAI vế: chuỗi và mempool hiện tại.
    // Thiếu vế mempool thì bấm nút hai lần thật nhanh là lọt hai giao dịch.
    if (collectFaucetClaims(chain).has(tx.fromAddr)) {
      return { ok: false, rule: 'faucet', detail: 'Địa chỉ này đã nhận faucet rồi', mempool };
    }
    if (hasPendingFaucet(mempool, tx.fromAddr)) {
      return {
        ok: false,
        rule: 'faucet',
        detail: 'Đã có một giao dịch faucet của địa chỉ này đang chờ xác nhận',
        mempool,
      };
    }
    // Faucet sinh tiền từ hư không nên KHÔNG áp kiểm số dư.
    return { ok: true, mempool: [...mempool, tx] };
  }

  // TẦNG C trong ngữ cảnh mempool.
  const available = availableBalance(chain, mempool, tx.fromAddr);
  if (available < tx.amount) {
    return {
      ok: false,
      rule: 'balance',
      detail: `Số dư khả dụng ${available} coin, không đủ để gửi ${tx.amount}`,
      mempool,
    };
  }

  return { ok: true, mempool: [...mempool, tx] };
}

// Bỏ khỏi mempool những giao dịch đã được đưa vào chuỗi.
export function removeConfirmed(mempool, chain) {
  const spent = collectSpentNonces(chain);
  return mempool.filter((tx) => !spent.has(txKey(tx)));
}

// Quét lại mempool với chuỗi mới sau reorg.
//
// BỎ BƯỚC NÀY thì mempool bẩn dần: những giao dịch mất căn cứ số dư vẫn nằm lại,
// bị gói vào block mình đào, và block đó bị máy kia reject mà không hiểu tại sao.
// Duyệt tuần tự và cộng dồn phần đã tiêu, giống hệt cách validate block làm.
export async function rescanMempool(mempool, chain) {
  const spent = collectSpentNonces(chain);
  const faucetClaims = collectFaucetClaims(chain);
  const spending = new Map();
  const kept = [];
  const dropped = [];

  for (const tx of mempool) {
    const auth = await verifyTxAuth(tx);
    if (!auth.ok) {
      dropped.push({ tx, reason: auth.detail });
      continue;
    }
    if (spent.has(txKey(tx))) {
      dropped.push({ tx, reason: 'Đã có trên chuỗi mới' });
      continue;
    }
    if (tx.type === TX_FAUCET) {
      if (faucetClaims.has(tx.fromAddr)) {
        dropped.push({ tx, reason: 'Đã nhận faucet trên chuỗi mới' });
        continue;
      }
      faucetClaims.set(tx.fromAddr, -1);
      kept.push(tx);
      continue;
    }
    const alreadySpending = spending.get(tx.fromAddr) || 0;
    const available = balanceOnChain(chain, tx.fromAddr) - alreadySpending;
    if (available < tx.amount) {
      dropped.push({ tx, reason: 'Không còn đủ số dư trên chuỗi mới' });
      continue;
    }
    spending.set(tx.fromAddr, alreadySpending + tx.amount);
    kept.push(tx);
  }

  return { mempool: kept, dropped };
}

// Đưa lại vào mempool những giao dịch bị bật ra khỏi chuỗi cũ sau reorg.
export async function reinsertDropped(mempool, droppedTxs, chain) {
  let next = mempool;
  for (const tx of droppedTxs) {
    if (tx.type === TX_COINBASE) continue;
    const result = await addTransaction(next, tx, chain);
    if (result.ok) next = result.mempool;
  }
  return next;
}
