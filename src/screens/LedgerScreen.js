// Sổ cái — nơi thấy được hai loại chữ ký nằm chung một chuỗi.
//
// Nhãn S/E của mỗi giao dịch lấy theo sigAlg của NGƯỜI KÝ, không phải theo loại
// ví đang xem. Nhờ vậy một ví E mở màn này vẫn thấy màu cam của ví S xen kẽ —
// đó là bằng chứng nhìn được rằng cả hai thuật toán dùng chung một blockchain.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { Screen, Card, Button, Banner, StatRow } from '../components/ui.js';
import WalletTypeBadge from '../components/WalletTypeBadge.js';
import { colors, mono } from '../theme.js';
import { getAlgorithm } from '../crypto/algorithms.js';
import { shortenAddress } from '../crypto/address.js';
import { validateChain, verifyTxAuth } from '../blockchain/validate.js';
import { getActiveNode, requestChain } from '../blockchain/runtime.js';
import { TX_COINBASE, TX_FAUCET, TX_TRANSFER } from '../blockchain/constants.js';

const TYPE_LABEL = {
  [TX_COINBASE]: 'Thưởng đào',
  [TX_FAUCET]: 'Faucet',
  [TX_TRANSFER]: 'Chuyển',
};

// Verify bao nhiêu chữ ký thì nhả luồng một lần. Đếm theo giao dịch chứ không
// theo block vì một block đông giao dịch cũng đủ làm đứng màn hình.
const VERIFY_YIELD_EVERY = 10;

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

// Thống kê chữ ký của một block. Đếm theo sigAlg thật của từng giao dịch và cộng
// độ dài chữ ký thật, không dùng số byte danh nghĩa của thuật toán.
function signatureStats(block) {
  const perAlgorithm = new Map();
  let totalBytes = 0;
  for (const tx of block.transactions) {
    if (tx.type === TX_COINBASE) continue;
    if (typeof tx.signature !== 'string') continue;
    const bytes = tx.signature.length / 2;
    totalBytes += bytes;
    const entry = perAlgorithm.get(tx.sigAlg) || { count: 0, bytes: 0 };
    entry.count++;
    entry.bytes += bytes;
    perAlgorithm.set(tx.sigAlg, entry);
  }
  return { perAlgorithm, totalBytes };
}

function StatsLine({ block }) {
  const { perAlgorithm, totalBytes } = signatureStats(block);
  if (perAlgorithm.size === 0) {
    return <Text style={styles.blockStats}>Block này: chỉ có coinbase, không có chữ ký nào.</Text>;
  }
  const parts = [];
  for (const [algorithmId, entry] of perAlgorithm) {
    const algorithm = getAlgorithm(algorithmId);
    parts.push(`${entry.count} chữ ký ${algorithm ? algorithm.name : algorithmId}`);
  }
  return (
    <Text style={styles.blockStats}>
      Block này: {parts.join(', ')} — tổng {totalBytes} byte chữ ký
    </Text>
  );
}

function TxRow({ tx, myAddress, verdict }) {
  const algorithm = getAlgorithm(tx.sigAlg);
  const isCoinbase = tx.type === TX_COINBASE;
  const mine = tx.to === myAddress || tx.fromAddr === myAddress;

  return (
    <View style={[styles.txRow, mine && styles.txRowMine]}>
      <View style={styles.txBadge}>
        {isCoinbase ? (
          <View style={styles.coinbaseBadge}>
            <Text style={styles.coinbaseLetter}>⛏</Text>
          </View>
        ) : (
          <WalletTypeBadge algorithmId={tx.sigAlg} size="sm" />
        )}
      </View>
      <View style={styles.txBody}>
        <View style={styles.txHead}>
          <Text style={styles.txType}>{TYPE_LABEL[tx.type] || tx.type}</Text>
          {algorithm ? (
            <Text style={[styles.txAlg, { color: algorithm.color }]}>{algorithm.name}</Text>
          ) : null}
          <View style={styles.spacer} />
          <Text style={styles.txAmount}>{tx.amount} coin</Text>
        </View>
        <Text style={styles.txAddr} numberOfLines={1}>
          {isCoinbase ? 'mạng' : shortenAddress(tx.fromAddr)} → {shortenAddress(tx.to)}
        </Text>
        {!isCoinbase && typeof tx.signature === 'string' ? (
          <Text style={styles.txSig} numberOfLines={1}>
            {tx.signature.slice(0, 20)}… · {tx.signature.length / 2} byte
          </Text>
        ) : null}
        {verdict ? (
          <Text style={[styles.txVerdict, { color: verdict.ok ? colors.ok : colors.danger }]}>
            {verdict.ok ? 'Chữ ký hợp lệ' : `Sai: ${verdict.detail}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function BlockCard({ block, height, myAddress, verdicts, expanded, onToggle }) {
  const confirmations = height - block.index;
  const coinbase = block.transactions.find((tx) => tx.type === TX_COINBASE);

  return (
    <Card>
      <Pressable onPress={onToggle} style={styles.blockHead}>
        <View style={styles.blockIndexBox}>
          <Text style={styles.blockIndexLabel}>Block</Text>
          <Text style={styles.blockIndex}>#{block.index}</Text>
        </View>
        <View style={styles.blockInfo}>
          <Text style={styles.blockHash} numberOfLines={1}>
            {block.hash}
          </Text>
          <Text style={styles.blockMeta}>
            {block.transactions.length} giao dịch · {confirmations} xác nhận ·{' '}
            {new Date(block.timestamp).toLocaleTimeString('vi-VN')}
          </Text>
          <Text style={styles.blockMiner} numberOfLines={1}>
            Đào bởi {coinbase && coinbase.to === myAddress ? 'bạn' : shortenAddress(block.miner)}
          </Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '−' : '+'}</Text>
      </Pressable>

      <StatsLine block={block} />

      {expanded ? (
        <View style={styles.txList}>
          {block.transactions.map((tx, i) => (
            <TxRow
              key={`${block.hash}-${i}`}
              tx={tx}
              myAddress={myAddress}
              verdict={verdicts ? verdicts.get(`${block.hash}-${i}`) : null}
            />
          ))}
          <View style={styles.blockFooter}>
            <Text style={styles.footerLabel}>previousHash</Text>
            <Text style={styles.footerValue} numberOfLines={1}>
              {block.previousHash}
            </Text>
            <Text style={styles.footerLabel}>nonce</Text>
            <Text style={styles.footerValue}>{block.nonce}</Text>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

export default function LedgerScreen({ session, nodeState }) {
  const node = getActiveNode();
  const chain = node ? node.getChain() : [];
  const mempool = node ? node.getMempool() : [];

  const [expanded, setExpanded] = useState(() => new Set());
  const [chainStatus, setChainStatus] = useState(null);
  const [verdicts, setVerdicts] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const chainKey = chain.length > 0 ? chain[chain.length - 1].hash : 'empty';

  const checkChain = useCallback(async () => {
    try {
      const result = await validateChain(chain);
      setChainStatus(result);
      // Chuỗi đổi thì kết quả verify cũ không còn ứng với block nào nữa.
      setVerdicts(null);
      setError(null);
    } catch (e) {
      setError(`Không kiểm được chuỗi: ${e.message}`);
    }
  }, [chainKey]);

  useEffect(() => {
    checkChain();
  }, [checkChain]);

  // Verify lại toàn bộ chữ ký trên chuỗi.
  //
  // Nhả luồng theo SỐ GIAO DỊCH chứ không theo block: một block có thể chứa rất
  // nhiều giao dịch, nhả mỗi block một lần thì block to vẫn làm đứng màn hình.
  const verifyAll = async () => {
    setVerifying(true);
    setError(null);
    try {
      const map = new Map();
      let sinceYield = 0;
      for (const block of chain) {
        for (let i = 0; i < block.transactions.length; i++) {
          const tx = block.transactions[i];
          if (tx.type === TX_COINBASE) continue;
          map.set(`${block.hash}-${i}`, await verifyTxAuth(tx));
          if (++sinceYield >= VERIFY_YIELD_EVERY) {
            sinceYield = 0;
            await yieldToUi();
          }
        }
      }
      setVerdicts(map);
      setExpanded(new Set(chain.map((b) => b.hash)));
    } catch (e) {
      setError(`Kiểm chữ ký thất bại: ${e.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const totals = useMemo(() => {
    const perAlgorithm = new Map();
    let signatureBytes = 0;
    for (const block of chain) {
      const stats = signatureStats(block);
      signatureBytes += stats.totalBytes;
      for (const [algorithmId, entry] of stats.perAlgorithm) {
        const current = perAlgorithm.get(algorithmId) || { count: 0, bytes: 0 };
        perAlgorithm.set(algorithmId, {
          count: current.count + entry.count,
          bytes: current.bytes + entry.bytes,
        });
      }
    }
    return { perAlgorithm, signatureBytes };
  }, [chainKey, chain.length]);

  const failed = verdicts ? [...verdicts.values()].filter((v) => !v.ok).length : 0;

  const refresh = async () => {
    setRefreshing(true);
    try {
      requestChain();
      await checkChain();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.dim} />}>
      <Card title="Chuỗi">
        {chainStatus ? (
          <Banner
            tone={chainStatus.ok ? 'ok' : 'error'}
            title={chainStatus.ok ? '✓ Chuỗi hợp lệ' : '✗ Chuỗi có block sai luật'}
          >
            {chainStatus.ok
              ? `${chain.length} block đã kiểm lại đủ luật: hash, độ khó, liên kết, chữ ký, số dư.`
              : chainStatus.detail}
          </Banner>
        ) : null}

        <StatRow label="Chiều cao" value={`${chain.length} block`} />
        <StatRow label="Đang chờ trong mempool" value={`${mempool.length} giao dịch`} />
        <StatRow label="Block bạn đào" value={`${nodeState.mined || 0}`} />
        {[...totals.perAlgorithm].map(([algorithmId, entry]) => {
          const algorithm = getAlgorithm(algorithmId);
          return (
            <StatRow
              key={algorithmId}
              label={`Chữ ký ${algorithm ? algorithm.name : algorithmId}`}
              value={`${entry.count} cái · ${entry.bytes} byte`}
              valueColor={algorithm ? algorithm.color : undefined}
            />
          );
        })}
        {totals.perAlgorithm.size === 2 ? (
          <Text style={styles.mixNote}>
            Hai loại chữ ký đang nằm chung một chuỗi. Nhãn màu bên dưới đi theo sigAlg của người ký
            chứ không theo ví đang xem.
          </Text>
        ) : null}

        <Button
          title={verifying ? 'Đang kiểm…' : 'Kiểm lại toàn bộ chữ ký'}
          tone="ghost"
          busy={verifying}
          onPress={verifyAll}
        />
        {error ? <Banner tone="error" title="Lỗi">{error}</Banner> : null}
        {verdicts ? (
          <Text style={[styles.verifySummary, { color: failed === 0 ? colors.ok : colors.danger }]}>
            {failed === 0
              ? `Đã kiểm ${verdicts.size} chữ ký, tất cả hợp lệ.`
              : `${failed}/${verdicts.size} chữ ký KHÔNG hợp lệ.`}
          </Text>
        ) : null}
      </Card>

      {mempool.length > 0 ? (
        <Card title={`Mempool (${mempool.length})`} subtitle="Chưa vào block nào, chưa tính vào số dư.">
          {mempool.map((tx) => (
            <TxRow key={`${tx.fromAddr}-${tx.nonce}`} tx={tx} myAddress={session.address} />
          ))}
        </Card>
      ) : null}

      {[...chain].reverse().map((block) => (
        <BlockCard
          key={block.hash}
          block={block}
          height={chain.length}
          myAddress={session.address}
          verdicts={verdicts}
          expanded={expanded.has(block.hash)}
          onToggle={() =>
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(block.hash)) next.delete(block.hash);
              else next.add(block.hash);
              return next;
            })
          }
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  mixNote: { color: colors.faint, fontSize: 12, lineHeight: 17 },
  verifySummary: { fontSize: 13, fontWeight: '600' },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  blockIndexBox: { alignItems: 'center' },
  blockIndexLabel: { color: colors.faint, fontSize: 10 },
  blockIndex: { color: colors.text, fontSize: 17, fontWeight: '700' },
  blockInfo: { flex: 1, gap: 2 },
  blockHash: { color: colors.accent, fontFamily: mono, fontSize: 10.5 },
  blockMeta: { color: colors.dim, fontSize: 12 },
  blockMiner: { color: colors.faint, fontSize: 11.5 },
  chevron: { color: colors.dim, fontSize: 20, width: 16, textAlign: 'center' },
  blockStats: { color: colors.dim, fontSize: 12.5, lineHeight: 18 },
  txList: { gap: 8, marginTop: 4 },
  txRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  txRowMine: { borderColor: colors.accent },
  txBadge: { paddingTop: 2 },
  txBody: { flex: 1, gap: 2 },
  txHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  txType: { color: colors.text, fontSize: 13, fontWeight: '600' },
  txAlg: { fontSize: 11, fontWeight: '600' },
  spacer: { flex: 1 },
  txAmount: { color: colors.text, fontSize: 13, fontWeight: '700' },
  txAddr: { color: colors.dim, fontFamily: mono, fontSize: 11 },
  txSig: { color: colors.faint, fontFamily: mono, fontSize: 10.5 },
  txVerdict: { fontSize: 11.5, fontWeight: '600' },
  coinbaseBadge: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinbaseLetter: { color: colors.dim, fontSize: 10 },
  blockFooter: { gap: 2, paddingTop: 4 },
  footerLabel: { color: colors.faint, fontSize: 10.5 },
  footerValue: { color: colors.dim, fontFamily: mono, fontSize: 10.5 },
});
