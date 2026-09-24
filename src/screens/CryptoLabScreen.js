// Phòng thí nghiệm mã hoá — so sánh secp256k1 và Ed25519 theo bốn tiêu chí:
// bảo mật, hiệu năng, tính linh hoạt, độ dễ triển khai.
//
// Mỗi mục trình bày đúng ba phần: mô tả cách đo, bảng kết quả, một câu nhận xét
// rút ra từ chính số vừa đo. Khối nào là kiến thức đã biết chứ không phải số đo
// thì được đánh dấu riêng bằng viền khác màu.
//
// Mọi con số ở đây đo trên CHÍNH máy này. Máy khác, thư viện khác thì ra số
// khác — xu hướng đúng nhưng trị tuyệt đối không mang đi chỗ khác được.
//
// Khoá dùng trong tab này là khoá tạm sinh tại chỗ. Không đụng tới khoá thật
// trong ví, nhờ vậy cả hai thuật toán đều chạy được bất kể bạn đang đăng nhập
// bằng ví loại nào.

import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Screen, Card, Button, Banner, Input } from '../components/ui.js';
import WalletTypeBadge from '../components/WalletTypeBadge.js';
import { colors, mono } from '../theme.js';
import {
  listAlgorithms,
  getAlgorithm,
  ALG_SECP256K1,
  ALG_ED25519,
} from '../crypto/algorithms.js';
import { deriveAddress } from '../crypto/address.js';
import { hashPayload, serializePayload, buildTransfer } from '../blockchain/validate.js';
import { utf8ToBytes } from '../crypto/bytes.js';

const DEFAULT_ROUNDS = 100;
const MAX_ROUNDS = 2000;
// Dưới mức này số đo dao động quá mạnh để kết luận được, nhưng vẫn cho chạy
// nếu người dùng xác nhận.
const MIN_STABLE_ROUNDS = 10;
const SIG_PREVIEW = 8; // số ký tự đầu chữ ký hiện ra để nhìn giống/khác
const SIG_PREVIEW_COUNT = 5; // số chữ ký hiện ra, đủ nhìn giống/khác mà không tràn dòng

const SAMPLE_NONCE = '00112233445566778899aabbccddeeff';
// Đổi đúng MỘT ký tự cuối nonce: payload khác đi nhưng độ dài giữ nguyên, nên
// thời gian verify không bị nhiễu bởi kích thước đầu vào.
const TAMPERED_NONCE = SAMPLE_NONCE.slice(0, -1) + '0';

// Bảng kiến thức đã biết, KHÔNG phải số đo.
const SECURITY_FACTS = [
  {
    label: 'Mô hình an toàn chữ ký',
    values: {
      [ALG_SECP256K1]: 'EUF-CMA / ECDSA',
      [ALG_ED25519]: 'EUF-CMA / EdDSA',
    },
  },
  {
    label: 'Security strength',
    values: {
      [ALG_SECP256K1]: 'Khoảng mức 128-bit*',
      [ALG_ED25519]: 'Khoảng mức 128-bit*',
    },
  },
  {
    label: 'Kháng lượng tử',
    values: {
      [ALG_SECP256K1]: 'Không',
      [ALG_ED25519]: 'Không',
    },
  },
  {
    label: 'Nonce / tính tất định',
    values: {
      [ALG_SECP256K1]: 'ECDSA dùng nonce; triển khai có thể dùng RFC 6979',
      [ALG_ED25519]: 'Nonce được sinh tất định theo thiết kế',
    },
  },
];

const IMPLEMENTATION_FACTS = [
  {
    label: 'Cần setup thủ công',
    values: {
      [ALG_SECP256K1]: 'Không',
      [ALG_ED25519]: 'Có — phải gán hàm băm sha512 trước khi dùng',
    },
  },
  {
    label: 'Định dạng chữ ký',
    values: {
      [ALG_SECP256K1]: 'DER, 70–72 byte, độ dài thay đổi, cần parse',
      [ALG_ED25519]: 'Raw 64 byte cố định',
    },
  },
  {
    label: 'Hệ sinh thái',
    values: { [ALG_SECP256K1]: 'Bitcoin, Ethereum', [ALG_ED25519]: 'SSH, Signal, Solana, Cardano' },
  },
];

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

function now() {
  return globalThis.performance && globalThis.performance.now
    ? globalThis.performance.now()
    : Date.now();
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function ms(value) {
  return `${value.toFixed(3)} ms`;
}

// Số lần, viết theo kiểu Việt: dấu phẩy thập phân.
function ratio(a, b) {
  return (a / b).toFixed(1).replace('.', ',');
}

function algName(entry) {
  return getAlgorithm(entry.id).name;
}

// Cặp nhanh nhất / chậm nhất theo một phép đo, dùng để viết câu nhận xét mà
// không phải viết cứng tên thuật toán nào nhanh hơn.
function extremes(entries, read) {
  const sorted = [...entries].sort((a, b) => read(a) - read(b));
  return { fast: sorted[0], slow: sorted[sorted.length - 1] };
}

// Giao dịch mẫu để đo — cùng một nội dung cho cả hai thuật toán nên phần khác
// nhau về kích thước chỉ đến từ public key và chữ ký.
function sampleTx(algorithm, publicKeyHex, address, nonce = SAMPLE_NONCE) {
  return buildTransfer({
    from: publicKeyHex,
    fromAddr: address,
    to: address,
    amount: 25,
    sigAlg: algorithm.id,
    timestamp: 1755331200000,
    nonce,
  });
}

// Đo tốc độ của MỘT thuật toán. Nhả luồng sau mỗi vòng để màn hình không đứng.
async function measureAlgorithm(algorithm, rounds, onProgress) {
  const keygen = [];
  const signing = [];
  const verifying = [];

  const keys = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = now();
    const privateKey = await algorithm.generatePrivateKeyHex();
    const publicKey = await algorithm.getPublicKeyHex(privateKey);
    keygen.push(now() - t0);
    keys.push({ privateKey, publicKey });
    if (i % 10 === 0) {
      await yieldToUi();
      if (onProgress) onProgress(`${algorithm.name}: sinh khoá ${i}/${rounds}`);
    }
  }

  const address = deriveAddress(algorithm.id, keys[0].publicKey);
  const tx = sampleTx(algorithm, keys[0].publicKey, address);
  const digest = hashPayload(tx);

  const signatures = [];
  for (let i = 0; i < rounds; i++) {
    const key = keys[i];
    const t0 = now();
    const result = await algorithm.sign(digest, key.privateKey);
    signing.push(now() - t0);
    signatures.push({ signature: result.signature, publicKey: key.publicKey });
    if (i % 10 === 0) {
      await yieldToUi();
      if (onProgress) onProgress(`${algorithm.name}: ký ${i}/${rounds}`);
    }
  }

  for (let i = 0; i < rounds; i++) {
    const item = signatures[i];
    const t0 = now();
    await algorithm.verify(item.signature, digest, item.publicKey);
    verifying.push(now() - t0);
    if (i % 10 === 0) {
      await yieldToUi();
      if (onProgress) onProgress(`${algorithm.name}: verify ${i}/${rounds}`);
    }
  }

  // Verify liên tiếp cả xấp chữ ký. Đây là VÒNG LẶP TUẦN TỰ, không phải batch verify.
  if (onProgress) onProgress(`${algorithm.name}: verify ${rounds} chữ ký liên tiếp`);
  await yieldToUi();
  const batchStart = now();
  for (let i = 0; i < rounds; i++) {
    const item = signatures[i];
    await algorithm.verify(item.signature, digest, item.publicKey);
    if (i % 25 === 0) await yieldToUi();
  }
  const batchTotal = now() - batchStart;

  const signedTx = { ...tx, signature: signatures[0].signature };
  const keygenStat = { mean: mean(keygen), median: median(keygen) };
  const signStat = { mean: mean(signing), median: median(signing) };
  const verifyStat = { mean: mean(verifying), median: median(verifying) };

  return {
    id: algorithm.id,
    keygen: keygenStat,
    sign: signStat,
    verify: verifyStat,
    txCost: {
      mean: keygenStat.mean + signStat.mean + verifyStat.mean,
      median: keygenStat.median + signStat.median + verifyStat.median,
    },
    batch: { total: batchTotal, perSignature: batchTotal / rounds },
    sizes: {
      privateKeyBytes: 32,
      publicKeyBytes: keys[0].publicKey.length / 2,
      signatureBytes: signatures[0].signature.length / 2,
      payloadBytes: utf8ToBytes(serializePayload(tx)).length,
      totalTxBytes: utf8ToBytes(JSON.stringify(signedTx)).length,
    },
  };
}

// Ký CÙNG một payload nhiều lần bằng cùng một khoá và đếm số chữ ký khác nhau.
async function measureDeterminism(rounds, onProgress) {
  const results = [];
  for (const algorithm of listAlgorithms()) {
    const privateKey = await algorithm.generatePrivateKeyHex();
    const publicKey = await algorithm.getPublicKeyHex(privateKey);
    const address = deriveAddress(algorithm.id, publicKey);
    const digest = hashPayload(sampleTx(algorithm, publicKey, address));

    const modes = [];
    const defaults = [];
    for (let i = 0; i < rounds; i++) {
      const { signature } = await algorithm.sign(digest, privateKey);
      defaults.push(signature);
      await yieldToUi();
      if (onProgress && i % 10 === 0) {
        onProgress(`${algorithm.name}: ký tất định ${i}/${rounds}`);
      }
    }
    modes.push({
      label: 'mặc định',
      signatures: defaults,
      unique: new Set(defaults).size,
      allValid: await verifyAll(algorithm, defaults, digest, publicKey),
    });

    if (algorithm.supportsExtraEntropy) {
      const randomized = [];
      for (let i = 0; i < rounds; i++) {
        const { signature } = await algorithm.sign(digest, privateKey, { extraEntropy: true });
        randomized.push(signature);
        await yieldToUi();
        if (onProgress && i % 10 === 0) {
          onProgress(`${algorithm.name}: ký extraEntropy ${i}/${rounds}`);
        }
      }
      modes.push({
        label: 'extraEntropy',
        signatures: randomized,
        unique: new Set(randomized).size,
        allValid: await verifyAll(algorithm, randomized, digest, publicKey),
      });
    }

    if (onProgress) onProgress(`Tất định: ${algorithm.name}`);
    results.push({ id: algorithm.id, modes });
  }
  return results;
}

async function verifyAll(algorithm, signatures, digest, publicKey) {
  for (let i = 0; i < signatures.length; i++) {
    if (!(await algorithm.verify(signatures[i], digest, publicKey))) return false;
    if (i % 10 === 0) await yieldToUi();
  }
  return true;
}

// Thí nghiệm khôi phục public key từ chữ ký.
async function measureRecovery() {
  const results = [];
  for (const algorithm of listAlgorithms()) {
    const privateKey = await algorithm.generatePrivateKeyHex();
    const publicKey = await algorithm.getPublicKeyHex(privateKey);
    const address = deriveAddress(algorithm.id, publicKey);
    const digest = hashPayload(sampleTx(algorithm, publicKey, address));
    const publicKeyBytes = publicKey.length / 2;

    if (!algorithm.supportsRecovery) {
      results.push({ id: algorithm.id, supported: false, publicKeyBytes });
      continue;
    }

    // recovery id phải được giữ lại NGAY LÚC KÝ. Từ chuỗi hex DER về sau không
    // tính ngược ra được, nên chỗ nào cần khôi phục thì phải lưu nó cùng chữ ký.
    const { signature, recovery } = await algorithm.sign(digest, privateKey);
    const recovered = await algorithm.recoverPublicKeyHex(signature, digest, recovery);
    results.push({
      id: algorithm.id,
      supported: true,
      recovery,
      match: recovered === publicKey,
      publicKey,
      recovered,
      publicKeyBytes,
    });
  }
  return results;
}

// Kiểm tra tính toàn vẹn của chữ ký:
// ký payload gốc, sau đó sửa payload và dùng lại chữ ký cũ.
// Đây là kiểm tra thực nghiệm về hành vi verify, KHÔNG phải bằng chứng EUF-CMA.
async function measureIntegrity(rounds, onProgress) {
  const results = [];

  for (const algorithm of listAlgorithms()) {
    let originalAccepted = 0;
    let tamperedRejected = 0;

    for (let i = 0; i < rounds; i++) {
      const privateKey = await algorithm.generatePrivateKeyHex();
      const publicKey = await algorithm.getPublicKeyHex(privateKey);
      const address = deriveAddress(algorithm.id, publicKey);

      const originalTx = sampleTx(
        algorithm,
        publicKey,
        address,
        SAMPLE_NONCE
      );

      const tamperedTx = sampleTx(
        algorithm,
        publicKey,
        address,
        TAMPERED_NONCE
      );

      const digest = hashPayload(originalTx);
      const tamperedDigest = hashPayload(tamperedTx);

      const { signature } = await algorithm.sign(digest, privateKey);

      const originalValid = await algorithm.verify(
        signature,
        digest,
        publicKey
      );

      const tamperedValid = await algorithm.verify(
        signature,
        tamperedDigest,
        publicKey
      );

      if (originalValid) originalAccepted++;
      if (!tamperedValid) tamperedRejected++;

      if (i % 10 === 0) {
        await yieldToUi();
        if (onProgress) {
          onProgress(
            `${algorithm.name}: kiểm tra toàn vẹn ${i}/${rounds}`
          );
        }
      }
    }

    results.push({
      id: algorithm.id,
      originalAccepted,
      tamperedRejected,
      rounds,
    });
  }

  return results;
}

// Kiểm tra thực nghiệm chống dùng chữ ký của payload này
// cho một payload khác.
// Không thể dùng phép thử nhỏ này để chứng minh EUF-CMA.
async function measureForgery(rounds, onProgress) {
  const results = [];

  for (const algorithm of listAlgorithms()) {
    let rejected = 0;
    let accepted = 0;

    for (let i = 0; i < rounds; i++) {
      const privateKey = await algorithm.generatePrivateKeyHex();
      const publicKey = await algorithm.getPublicKeyHex(privateKey);
      const address = deriveAddress(algorithm.id, publicKey);

      const originalTx = sampleTx(
        algorithm,
        publicKey,
        address,
        SAMPLE_NONCE
      );

      const otherTx = sampleTx(
        algorithm,
        publicKey,
        address,
        TAMPERED_NONCE
      );

      const originalDigest = hashPayload(originalTx);
      const otherDigest = hashPayload(otherTx);

      const { signature } = await algorithm.sign(
        originalDigest,
        privateKey
      );

      // Cố dùng chữ ký của payload A cho payload B.
      const valid = await algorithm.verify(
        signature,
        otherDigest,
        publicKey
      );

      if (valid) {
        accepted++;
      } else {
        rejected++;
      }

      if (i % 10 === 0) {
        await yieldToUi();
        if (onProgress) {
          onProgress(
            `${algorithm.name}: kiểm tra chống giả mạo ${i}/${rounds}`
          );
        }
      }
    }

    results.push({
      id: algorithm.id,
      rejected,
      accepted,
      rounds,
    });
  }

  return results;
}

// ---- Mảnh giao diện ----

// Bảng đo dựng theo REGISTRY: mỗi thuật toán một cột. Thêm thuật toán thứ ba thì
// bảng tự mọc thêm cột, không phải sửa gì ở đây.
function TableHeader() {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} />
      {listAlgorithms().map((algorithm) => (
        <Text key={algorithm.id} style={[styles.rowHead, { color: algorithm.color }]}>
          {algorithm.name}
        </Text>
      ))}
    </View>
  );
}

function Row({ label, speed, read, highlight }) {
  return (
    <View style={[styles.row, highlight && styles.rowHighlight]}>
      <Text style={styles.rowLabel}>{label}</Text>
      {speed.map((entry) => (
        <Text key={entry.id} style={[styles.rowValue, { color: getAlgorithm(entry.id).color }]}>
          {read(entry)}
        </Text>
      ))}
    </View>
  );
}

// Bảng chữ (không phải số đo): căn trái vì giá trị dài và hay xuống dòng.
function FactTable({ facts }) {
  return (
    <View>
      <View style={styles.factRow}>
        <Text style={styles.factLabel} />
        {listAlgorithms().map((algorithm) => (
          <Text key={algorithm.id} style={[styles.factHead, { color: algorithm.color }]}>
            {algorithm.name}
          </Text>
        ))}
      </View>
      {facts.map((fact) => (
        <View key={fact.label} style={styles.factRow}>
          <Text style={styles.factLabel}>{fact.label}</Text>
          {listAlgorithms().map((algorithm) => (
            <Text key={algorithm.id} style={styles.factValue}>
              {fact.values[algorithm.id]}
            </Text>
          ))}
        </View>
      ))}
      <Text style={styles.factNote}>
        * Security strength là đánh giá lý thuyết/cryptanalytic, không phải số đo được từ
        phép benchmark của ứng dụng này.
      </Text>
    </View>
  );
}

// Vùng viền vàng: đánh dấu rõ đây là kiến thức đã biết, không phải số đo.
function KnownBlock({ label, children }) {
  return (
    <View style={styles.known}>
      <Text style={styles.knownLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Section({ title, description, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionDesc}>{description}</Text>
      {children}
    </View>
  );
}

// Chip xổ ra / thu lại. Mỗi chip giữ trạng thái riêng nên đóng cái này không
// ảnh hưởng cái khác; mặc định đóng.
function Verdict({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.verdictWrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.verdictChip, pressed && styles.verdictChipPressed]}
      >
        <Text style={styles.verdictTag}>Nhận xét</Text>
        <Text style={[styles.verdictCaret, open && styles.verdictCaretOpen]}>▸</Text>
      </Pressable>
      {open ? <Text style={styles.verdict}>{children}</Text> : null}
    </View>
  );
}

function AlgorithmHead({ id }) {
  const algorithm = getAlgorithm(id);
  return (
    <View style={styles.experimentHead}>
      <WalletTypeBadge algorithmId={id} size="sm" />
      <Text style={[styles.experimentTitle, { color: algorithm.color }]}>{algorithm.fullName}</Text>
    </View>
  );
}

function parseRounds(text) {
  if (!/^\d+$/.test(text.trim())) return null;
  const rounds = Number(text.trim());
  return rounds >= 1 && rounds <= MAX_ROUNDS ? rounds : null;
}

export default function CryptoLabScreen() {
  const [integrity, setIntegrity] = useState(null);
  const [forgery, setForgery] = useState(null); 
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [speed, setSpeed] = useState(null);
  const [determinism, setDeterminism] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [error, setError] = useState(null);
  const [roundsText, setRoundsText] = useState(String(DEFAULT_ROUNDS));
  const [roundsError, setRoundsError] = useState(null);
  const [pending, setPending] = useState(null); // số vòng quá ít, chờ xác nhận
  // Số vòng của lần đo ĐANG HIỂN THỊ. Tách khỏi ô nhập để người dùng sửa ô
  // sau khi đo xong thì các câu mô tả không mô tả sai số vừa đo.
  const [shownRounds, setShownRounds] = useState(DEFAULT_ROUNDS);
  const [started, setStarted] = useState(false);
  // Đổi mỗi lần đo để hai khối tĩnh dựng lại, kéo mọi chip nhận xét về đóng.
  const [runId, setRunId] = useState(0);

  const run = async (rounds) => {
    setBusy(true);
    setError(null);
    setSpeed(null);
    setIntegrity(null);
    setForgery(null);
    setDeterminism(null);
    setRecovery(null);
    setShownRounds(rounds);
    setStarted(true);
    setRunId((id) => id + 1);

    try {
      const measured = [];

      for (const algorithm of listAlgorithms()) {
        measured.push(
          await measureAlgorithm(
            algorithm,
            rounds,
            setProgress
          )
        );
      }

      setSpeed(measured);

      setIntegrity(
        await measureIntegrity(rounds, setProgress)
      );

      setForgery(
        await measureForgery(rounds, setProgress)
      );

      setDeterminism( await measureDeterminism(rounds, setProgress));
      setRecovery(
        await measureRecovery()
      );

      setProgress(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const requestRun = () => {
    const rounds = parseRounds(roundsText);
    if (rounds === null) {
      setPending(null);
      setRoundsError(`Số vòng phải là số nguyên từ 1 đến ${MAX_ROUNDS}.`);
      return;
    }
    setRoundsError(null);
    if (rounds < MIN_STABLE_ROUNDS) {
      setPending(rounds);
      return;
    }
    setPending(null);
    run(rounds);
  };
  const ready = speed && integrity && forgery && determinism && recovery;

  return (
    <Screen>
      <Card title="Phòng thí nghiệm mã hoá">
        <Text style={styles.intro}>
          Tab này sinh khoá tạm ngay tại chỗ để đo, KHÔNG đụng tới khoá thật trong ví của bạn. Vì
          vậy cả hai thuật toán đều chạy được bất kể bạn đang đăng nhập bằng ví loại nào.
        </Text>
        <Text style={styles.intro}>
          Mỗi phép đo lặp lại đúng số vòng bạn đặt bên dưới, báo cả trung bình và trung vị. Trung vị
          đáng tin hơn khi máy bị nghẽn giữa chừng.
        </Text>
        <Input
          label="Số vòng mỗi phép đo"
          value={roundsText}
          onChangeText={(text) => {
            setRoundsText(text);
            setRoundsError(null);
            setPending(null);
          }}
          keyboardType="number-pad"
          maxLength={4}
          editable={!busy}
          hint={`Số nguyên từ 1 đến ${MAX_ROUNDS}. Mặc định ${DEFAULT_ROUNDS}.`}
        />
        {roundsError ? <Text style={styles.roundsError}>{roundsError}</Text> : null}
        {pending ? (
          <Banner tone="warn" title="Số vòng quá ít">
            <Text style={styles.pendingText}>
              {pending} vòng là quá ít, kết quả có thể không ổn định. Vẫn muốn đo?
            </Text>
            <View style={styles.pendingActions}>
              <Button
                title={`Vẫn đo ${pending} vòng`}
                tone="ghost"
                style={styles.pendingButton}
                onPress={() => {
                  setPending(null);
                  run(pending);
                }}
              />
              <Button
                title="Huỷ"
                tone="ghost"
                style={styles.pendingButton}
                onPress={() => setPending(null)}
              />
            </View>
          </Banner>
        ) : null}
        <Button
          title={busy ? 'Đang đo…' : speed ? 'Đo lại' : 'Bắt đầu đo'}
          onPress={requestRun}
          busy={busy}
        />
        {progress ? <Text style={styles.progress}>{progress}</Text> : null}
        {error ? <Banner tone="error" title="Đo thất bại">{error}</Banner> : null}
      </Card>

      {started ? (
        <Card title="Nhóm 1 — Bảo mật" key={runId}>
          <KnownBlock label="Kiến thức đã biết — theo nhóm tiêu chí Security của NIST">
            <FactTable facts={SECURITY_FACTS} />

            <Text style={styles.factNote}>
              Security strength là đánh giá lý thuyết/cryptanalytic, không phải số đo
              được từ benchmark của ứng dụng này. Các phép đo bên dưới chỉ kiểm tra
              hành vi thực tế của thư viện trong những tình huống cụ thể.
            </Text>
          </KnownBlock>

          {integrity ? (
            <Section
              title="1. Kiểm tra tính toàn vẹn chữ ký"
              description={`Ký payload gốc ${shownRounds} lần. Sau đó thay đúng một ký tự trong nonce của payload và dùng lại chữ ký cũ để verify. Payload nguyên vẹn phải được chấp nhận, còn payload bị sửa phải bị từ chối.`}
            >
              <TableHeader />

              <Row
                label="Payload nguyên vẹn — chấp nhận"
                speed={integrity}
                read={(r) => `${r.originalAccepted}/${shownRounds}`}
              />

              <Row
                label="Payload bị sửa — từ chối"
                speed={integrity}
                read={(r) => `${r.tamperedRejected}/${shownRounds}`}
                highlight
              />

              <Verdict>
                {integrity
                  .map(
                    (entry) =>
                      `${algName(entry)} từ chối ${entry.tamperedRejected}/${shownRounds} payload bị sửa`
                  )
                  .join('; ')}
                .
              </Verdict>
            </Section>
          ) : null}

          {forgery ? (
            <Section
              title="2. Kiểm tra chống giả mạo — thực nghiệm"
              description={`Ký một payload bằng khoá riêng, sau đó cố dùng chính chữ ký đó cho một payload khác ${shownRounds} lần. Đây là phép kiểm tra hành vi đơn giản lấy cảm hứng từ mục tiêu EUF-CMA, không phải phép chứng minh tính EUF-CMA.`}
            >
              <TableHeader />

              <Row
                label="Chữ ký bị từ chối"
                speed={forgery}
                read={(r) => `${r.rejected}/${shownRounds}`}
                highlight
              />

              <Row
                label="Chấp nhận giả mạo"
                speed={forgery}
                read={(r) => `${r.accepted}/${shownRounds}`}
              />

              <Verdict>
                {forgery
                  .map(
                    (entry) =>
                      `${algName(entry)} không chấp nhận chữ ký của payload khác trong ${entry.rejected}/${shownRounds} lần thử`
                  )
                  .join('; ')}
                . Kết quả này chỉ là kiểm tra thực nghiệm trên thư viện hiện tại,
                không thay thế phân tích hoặc chứng minh mật mã học.
              </Verdict>
            </Section>
          ) : null}

          {determinism ? (
            <Section
              title="3. Kiểm tra nonce và tính tất định"
              description={`Ký cùng một payload ${shownRounds} lần bằng cùng một khoá. Đếm số chữ ký khác nhau trong mỗi chế độ. Với secp256k1, kiểm tra cả chế độ mặc định và extraEntropy nếu thư viện hỗ trợ; với Ed25519, kiểm tra chế độ tất định theo thiết kế.`}
            >
              {determinism.map((entry) => (
                <View key={entry.id} style={styles.experiment}>
                  <AlgorithmHead id={entry.id} />

                  {entry.modes.map((mode) => (
                    <View key={mode.label} style={styles.mode}>
                      <Text style={styles.modeLabel}>
                        {mode.label}
                      </Text>

                      <Text
                        style={[
                          styles.modeResult,
                          {
                            color:
                              mode.unique === 1
                                ? colors.ok
                                : colors.warn,
                          },
                        ]}
                      >
                        {mode.unique}/{shownRounds} chữ ký khác nhau
                        {mode.allValid
                          ? ' · tất cả đều verify được'
                          : ' · CÓ CHỮ KÝ SAI'}
                      </Text>

                      <Text
                        style={styles.sigLine}
                        numberOfLines={1}
                      >
                        {mode.signatures
                          .slice(0, SIG_PREVIEW_COUNT)
                          .map((s) => s.slice(0, SIG_PREVIEW))
                          .join('  ')}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}

              <Verdict>
                {determinism
                  .flatMap((entry) =>
                    entry.modes.map(
                      (mode) =>
                        `${getAlgorithm(entry.id).name} ${mode.label}: ${mode.unique}/${shownRounds} chữ ký khác nhau`
                    )
                  )
                  .join('; ')}
                . Đây là quan sát về cơ chế sinh chữ ký/nonce của thư viện,
                không phải thước đo trực tiếp của mức độ an toàn.
              </Verdict>
            </Section>
          ) : null}
        </Card>
      ) : null}

      {speed ? (
        <Card title="Nhóm 2 — Hiệu năng">
          <Section
            title="Tốc độ ba phép cơ bản"
            description={`Sinh khoá, ký và verify cùng một payload ${shownRounds} lần bằng mỗi thuật toán, đo từng lần bằng đồng hồ hiệu năng của máy, báo trung bình (TB) và trung vị (TV).`}
          >
            <TableHeader />
            <Row label="Sinh khoá (TB)" speed={speed} read={(r) => ms(r.keygen.mean)} />
            <Row label="Sinh khoá (TV)" speed={speed} read={(r) => ms(r.keygen.median)} />
            <Row label="Ký (TB)" speed={speed} read={(r) => ms(r.sign.mean)} />
            <Row label="Ký (TV)" speed={speed} read={(r) => ms(r.sign.median)} />
            <Row label="Verify (TB)" speed={speed} read={(r) => ms(r.verify.mean)} />
            <Row label="Verify (TV)" speed={speed} read={(r) => ms(r.verify.median)} />
            {(() => {
              const { fast, slow } = extremes(speed, (r) => r.sign.median);
              return (
                <Verdict>
                  {algName(fast)} ký nhanh hơn {algName(slow)}{' '}
                  {ratio(slow.sign.median, fast.sign.median)} lần trên thiết bị này.
                </Verdict>
              );
            })()}
          </Section>

          <Section
            title="Tổng chi phí một giao dịch"
            description="Cộng dồn trung vị của ba phép sinh khoá, ký và verify để ra chi phí CPU của một giao dịch tính từ lúc tạo ví đến lúc xác minh xong."
          >
            <TableHeader />
            <Row label="Sinh khoá (TV)" speed={speed} read={(r) => ms(r.keygen.median)} />
            <Row label="Ký (TV)" speed={speed} read={(r) => ms(r.sign.median)} />
            <Row label="Verify (TV)" speed={speed} read={(r) => ms(r.verify.median)} />
            <Row label="Tổng" speed={speed} read={(r) => ms(r.txCost.median)} highlight />
            {(() => {
              const { fast, slow } = extremes(speed, (r) => r.txCost.median);
              return (
                <Verdict>
                  Một giao dịch trọn vẹn tốn {ms(fast.txCost.median)} với {algName(fast)} và{' '}
                  {ms(slow.txCost.median)} với {algName(slow)}, chênh{' '}
                  {ratio(slow.txCost.median, fast.txCost.median)} lần.
                </Verdict>
              );
            })()}
          </Section>

          <Section
            title="Kích thước"
            description="Đếm số byte thật của khoá, payload đã ký và toàn bộ giao dịch đã ký sinh ra trong phép đo trên. Cả hai đều là thuật toán chữ ký số: payload được ký chứ không được mã hoá. Nội dung giao dịch giống nhau, payload vẫn lệch vài byte vì public key nằm ngay trong đó."
          >
            <TableHeader />
            <Row label="Private key" speed={speed} read={(r) => `${r.sizes.privateKeyBytes} byte`} />
            <Row label="Public key" speed={speed} read={(r) => `${r.sizes.publicKeyBytes} byte`} />
            <Row label="Chữ ký" speed={speed} read={(r) => `${r.sizes.signatureBytes} byte`} />
            <Row label="Payload đã ký" speed={speed} read={(r) => `${r.sizes.payloadBytes} byte`} />
            <Row
              label="Tổng tx"
              speed={speed}
              read={(r) => `${r.sizes.totalTxBytes} byte`}
              highlight
            />
            {(() => {
              const { fast: small, slow: big } = extremes(speed, (r) => r.sizes.totalTxBytes);
              return (
                <Verdict>
                  Giao dịch {algName(small)} nhỏ hơn {algName(big)}{' '}
                  {big.sizes.totalTxBytes - small.sizes.totalTxBytes} byte: public key{' '}
                  {small.sizes.publicKeyBytes} so với {big.sizes.publicKeyBytes} byte, chữ ký{' '}
                  {small.sizes.signatureBytes} so với {big.sizes.signatureBytes} byte.
                </Verdict>
              );
            })()}
          </Section>
        </Card>
      ) : null}

      {ready ? (
        <Card title="Nhóm 3.1 — Tính linh hoạt">
          <Section
            title="a) Batch verify"
            description={`Batch verify là gộp nhiều chữ ký vào một phép kiểm tra chung thay vì kiểm từng cái. Kiểm tra API của thư viện đang cài xem có hàm nào làm việc đó không, rồi đo verify ${shownRounds} chữ ký bằng vòng lặp tuần tự để có mốc đối chiếu.`}
          >
            <TableHeader />
            <Row
              label="API batch verify"
              speed={speed}
              read={(r) => (getAlgorithm(r.id).supportsBatchVerify ? 'Có' : 'Không có')}
            />
            <Row
              label={`Tuần tự ${shownRounds} chữ ký`}
              speed={speed}
              read={(r) => ms(r.batch.total)}
              highlight
            />
            <Verdict>
              Thư viện hiện dùng không cung cấp API batch verify, nên {shownRounds} chữ ký chỉ đo được
              bằng vòng lặp tuần tự ({speed.map((r) => `${algName(r)} ${ms(r.batch.total)}`).join(', ')}
              ); xác minh theo lô là năng lực lý thuyết của Ed25519 và chưa đo được ở đây.
            </Verdict>
          </Section>

          <Section
            title="b) Khôi phục public key từ chữ ký"
            description="Ký một payload rồi thử dựng lại public key chỉ từ chữ ký, digest và recovery id, sau đó so với public key gốc. Recovery id phải được giữ ngay lúc ký vì chuỗi hex DER không tính ngược ra nó."
          >
            {recovery.map((entry) => (
              <View key={entry.id} style={styles.experiment}>
                <AlgorithmHead id={entry.id} />
                {entry.supported ? (
                  <>
                    <Text
                      style={[styles.modeResult, { color: entry.match ? colors.ok : colors.danger }]}
                    >
                      {entry.match
                        ? `Khôi phục thành công, khớp public key gốc (recovery id = ${entry.recovery})`
                        : 'Khôi phục ra khoá KHÔNG khớp'}
                    </Text>
                    <Text style={styles.sigLine} numberOfLines={1}>
                      gốc:       {entry.publicKey}
                    </Text>
                    <Text style={styles.sigLine} numberOfLines={1}>
                      khôi phục: {entry.recovered}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.modeResult}>
                    Không khôi phục được — chữ ký EdDSA không mang thông tin để dựng lại điểm khoá
                    công khai, người xác minh bắt buộc phải có sẵn public key.
                  </Text>
                )}
              </View>
            ))}
            <Verdict>
              {recovery
                .map((entry) =>
                  entry.supported
                    ? `${getAlgorithm(entry.id).name} khôi phục đúng khoá gốc nên giao dịch bớt được ${entry.publicKeyBytes} byte public key`
                    : `${getAlgorithm(entry.id).name} luôn phải gửi kèm ${entry.publicKeyBytes} byte public key`
                )
                .join('; ')}
              .
            </Verdict>
          </Section>

          <Section
            title="c) Tuỳ chọn ngẫu nhiên hoá"
            description={`Kiểm xem mỗi thuật toán có chế độ nào ngoài tất định không, dùng lại số chữ ký khác nhau trong ${shownRounds} lần ký đã đo ở khối Bảo mật.`}
          >
            <TableHeader />
            <Row
              label="Cờ ngẫu nhiên hoá"
              speed={speed}
              read={(r) => (getAlgorithm(r.id).supportsExtraEntropy ? 'extraEntropy' : 'Không có')}
            />
            <Row
              label="Tất định — số khác nhau"
              speed={speed}
              read={(r) => {
                const entry = determinism.find((d) => d.id === r.id);
                return `${entry.modes[0].unique}/${shownRounds}`;
              }}
            />
            <Row
              label="Ngẫu nhiên hoá — số khác nhau"
              speed={speed}
              read={(r) => {
                const entry = determinism.find((d) => d.id === r.id);
                return entry.modes[1] ? `${entry.modes[1].unique}/${shownRounds}` : '—';
              }}
              highlight
            />
            <Verdict>
              {determinism
                .map((entry) => {
                  const name = getAlgorithm(entry.id).name;
                  return entry.modes[1]
                    ? `${name} đổi được chế độ: tắt cờ cho ${entry.modes[0].unique}/${shownRounds} chữ ký khác nhau, bật cờ cho ${entry.modes[1].unique}/${shownRounds}`
                    : `${name} chỉ có một chế độ, ${entry.modes[0].unique}/${shownRounds} chữ ký khác nhau`;
                })
                .join('; ')}
              .
            </Verdict>
          </Section>
        </Card>
      ) : null}

      {started ? (
        <Card title="Nhóm 3.2 — Độ dễ triển khai" key={runId}>
          <KnownBlock label="Bảng dưới là kiến thức đã biết, không phải kết quả đo trên máy này.">
            <FactTable facts={IMPLEMENTATION_FACTS} />
            <Verdict>
              Ed25519 cần một bước setup thủ công nhưng đổi lại chữ ký cố định 64 byte; secp256k1
              không cần setup nhưng chữ ký DER 70–72 byte dài không cố định và phải parse trước khi
              verify.
            </Verdict>
          </KnownBlock>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: colors.dim, fontSize: 13, lineHeight: 19 },
  progress: { color: colors.faint, fontSize: 12, fontFamily: mono },
  section: { gap: 6, paddingTop: 4 },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  sectionDesc: { color: colors.dim, fontSize: 12.5, lineHeight: 18 },
  verdictWrap: { gap: 6, marginTop: 6 },
  verdictChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accent + '18',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  verdictChipPressed: { opacity: 0.7 },
  verdict: { color: colors.text, fontSize: 12.5, lineHeight: 18 },
  verdictTag: { color: colors.accent, fontWeight: '700', fontSize: 12 },
  verdictCaret: { color: colors.accent, fontSize: 11 },
  verdictCaretOpen: { transform: [{ rotate: '90deg' }] },
  roundsError: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  pendingText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  pendingActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  pendingButton: { flex: 1, paddingVertical: 9 },
  known: {
    borderWidth: 1,
    borderColor: colors.warn,
    backgroundColor: colors.warn + '14',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  knownLabel: { color: colors.warn, fontSize: 12.5, fontWeight: '700', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  rowHighlight: { backgroundColor: colors.cardAlt, borderRadius: 6 },
  rowLabel: { flex: 1.3, color: colors.dim, fontSize: 12.5 },
  rowHead: { flex: 1, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  rowValue: { flex: 1, fontSize: 12.5, fontWeight: '600', textAlign: 'right', fontFamily: mono },
  factRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 8,
  },
  factLabel: { flex: 1, color: colors.dim, fontSize: 12 },
  factHead: { flex: 1.15, fontSize: 12, fontWeight: '700' },
  factValue: { flex: 1.15, color: colors.text, fontSize: 11.5, lineHeight: 16 },
  experiment: { gap: 6, paddingTop: 6 },
  experimentHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  experimentTitle: { fontSize: 14, fontWeight: '700' },
  mode: { gap: 2, paddingLeft: 4, paddingTop: 4 },
  modeLabel: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
  modeResult: { color: colors.dim, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  sigLine: { color: colors.faint, fontFamily: mono, fontSize: 10.5 },
  factNote: { color: colors.faint, fontSize: 10.5, lineHeight: 15, marginTop: 2 },
});
