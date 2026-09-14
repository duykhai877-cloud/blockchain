// NodeCore — trạng thái blockchain của MỘT account.
//
// CÔ LẬP ACCOUNT (lớp phòng thủ thứ nhất trong ba lớp):
// Owner được CHỐT LÚC KHỞI TẠO và không có hàm nào đổi được nó. Mọi khoá lưu trữ
// đều nằm dưới namespace `v2:<address>:*`, không có key toàn cục kiểu `node:*`.
// Một điện thoại đăng nhập nhiều account thì mỗi account có một NodeCore riêng
// với chuỗi, mempool và bộ đếm đào tách biệt hoàn toàn.

import { createChain, createOrphanPool, chooseChain, droppedTransactions, findForkPoint, latestBlock } from './chain.js';
import { createMempool, addTransaction, removeConfirmed, reinsertDropped, rescanMempool } from './mempool.js';
import { balanceOnChain, validateBlock, validateChain } from './validate.js';
import { TX_COINBASE } from './constants.js';

function storageKey(owner, name) {
  return `v2:${owner}:${name}`;
}

export function createNode({ owner, storage, onEvent }) {
  if (typeof owner !== 'string' || owner.length === 0) {
    throw new Error('NodeCore phải có owner');
  }

  // Đóng băng owner: không export setter, không cho ghi đè.
  const OWNER = owner;
  let chain = createChain();
  let mempool = createMempool();
  const orphans = createOrphanPool();
  let stopped = false;
  let minedCount = 0;

  const emit = (type, payload) => {
    if (onEvent && !stopped) onEvent({ type, owner: OWNER, ...payload });
  };

  const api = {
    get owner() {
      return OWNER;
    },
    get stopped() {
      return stopped;
    },
    getChain: () => chain,
    getMempool: () => mempool,
    getHeight: () => chain.length,
    getMinedCount: () => minedCount,
    getOrphanCount: () => orphans.size(),
    getBalance: (addr = OWNER) => balanceOnChain(chain, addr),

    // Đánh dấu node đã chết. Mọi callback đến sau thời điểm này bị bỏ qua.
    stop() {
      stopped = true;
      orphans.clear();
    },

    async load() {
      if (!storage) return;
      const rawChain = await storage.getItem(storageKey(OWNER, 'chain'));
      if (rawChain) {
        const parsed = JSON.parse(rawChain);
        // Dữ liệu trên đĩa cũng không được tin: validate lại trước khi dùng.
        const result = await validateChain(parsed);
        if (result.ok && parsed.length > chain.length) chain = parsed;
      }
      const rawMempool = await storage.getItem(storageKey(OWNER, 'mempool'));
      if (rawMempool) {
        const parsed = JSON.parse(rawMempool);
        const rescanned = await rescanMempool(parsed, chain);
        mempool = rescanned.mempool;
      }
      const rawMined = await storage.getItem(storageKey(OWNER, 'mined'));
      if (rawMined) minedCount = Number.parseInt(rawMined, 10) || 0;
      emit('loaded', { height: chain.length });
    },

    async persist() {
      if (!storage || stopped) return;
      await storage.setItem(storageKey(OWNER, 'chain'), JSON.stringify(chain));
      await storage.setItem(storageKey(OWNER, 'mempool'), JSON.stringify(mempool));
      await storage.setItem(storageKey(OWNER, 'mined'), String(minedCount));
    },

    // Nhận giao dịch — từ chính mình hoặc từ mạng. Không phân biệt: cả hai đều
    // đi qua đúng bộ luật.
    async receiveTransaction(tx) {
      if (stopped) return { ok: false, rule: 'stopped', detail: 'Node đã dừng' };
      const result = await addTransaction(mempool, tx, chain);
      if (result.ok) {
        mempool = result.mempool;
        emit('mempool', { size: mempool.length });
        await api.persist();
      }
      return result;
    },

    // Nhận một block đơn lẻ.
    async receiveBlock(block) {
      if (stopped) return { ok: false, reason: 'stopped' };
      if (!block || typeof block.hash !== 'string') return { ok: false, reason: 'format' };
      if (chain.some((b) => b.hash === block.hash)) return { ok: false, reason: 'duplicate' };

      const tip = latestBlock(chain);
      if (block.previousHash !== tip.hash) {
        // Không nối được vào đỉnh hiện tại: có thể là nhánh khác hoặc block đến
        // sớm. Giữ trong RAM và xin lại toàn chuỗi để luật chuỗi dài nhất quyết định.
        orphans.add(block);
        emit('orphan', { count: orphans.size() });
        return { ok: false, reason: 'orphan' };
      }

      const result = await validateBlock(block, tip, chain);
      if (!result.ok) {
        emit('rejected', { scope: 'block', reason: result.reason, detail: result.detail });
        return { ok: false, ...result };
      }

      chain = [...chain, block];
      mempool = removeConfirmed(mempool, chain);
      emit('block', { height: chain.length, index: block.index, miner: block.miner });

      // Block mồ côi nào nối được vào block vừa nhận thì thử luôn.
      for (const orphan of orphans.take(block.hash)) {
        await api.receiveBlock(orphan);
      }

      await api.persist();
      return { ok: true };
    },

    // Nhận nguyên một chuỗi từ node khác. Đây là nơi xử lý fork và reorg.
    async receiveChain(candidate) {
      if (stopped) return { ok: false, reason: 'stopped' };
      const decision = await chooseChain(chain, candidate);
      if (!decision.replace) {
        if (decision.reason === 'invalid') {
          // Chuỗi dài hơn nhưng chứa block sai luật thì KHÔNG được theo.
          emit('rejected', { scope: 'chain', reason: 'invalid', detail: decision.detail });
        }
        return { ok: false, ...decision };
      }

      const oldChain = chain;
      const forkIndex = findForkPoint(oldChain, candidate);
      chain = candidate;

      // Sau reorg: quét lại mempool với chuỗi mới, rồi đưa lại những giao dịch
      // bị bật ra khỏi chuỗi cũ.
      const rescanned = await rescanMempool(mempool, chain);
      mempool = await reinsertDropped(rescanned.mempool, droppedTransactions(oldChain, forkIndex), chain);

      emit('reorg', {
        height: chain.length,
        forkIndex,
        droppedBlocks: oldChain.length - forkIndex,
        droppedTxs: rescanned.dropped.length,
      });
      await api.persist();
      return { ok: true, forkIndex };
    },

    // Ghi nhận block do chính mình đào. Đi qua đúng receiveBlock nên block của
    // mình cũng phải qua đủ luật — thợ đào không được ưu tiên.
    async acceptOwnBlock(block) {
      const result = await api.receiveBlock(block);
      if (result.ok) {
        minedCount++;
        await api.persist();
      }
      return result;
    },

    async rescan() {
      const rescanned = await rescanMempool(mempool, chain);
      mempool = rescanned.mempool;
      return rescanned.dropped;
    },

    // Thống kê cho màn sổ cái.
    stats() {
      let transfers = 0;
      let faucets = 0;
      for (const block of chain) {
        for (const tx of block.transactions) {
          if (tx.type === TX_COINBASE) continue;
          if (tx.type === 'FAUCET') faucets++;
          else transfers++;
        }
      }
      return { height: chain.length, transfers, faucets, mempool: mempool.length, mined: minedCount };
    },
  };

  return api;
}

export function nodeStorageKeys(owner) {
  return [storageKey(owner, 'chain'), storageKey(owner, 'mempool'), storageKey(owner, 'mined')];
}
