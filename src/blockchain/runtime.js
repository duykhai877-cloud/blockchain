// Runtime — vòng đời của node đang chạy: vòng đào, WebSocket, heartbeat.
//
// CÔ LẬP ACCOUNT — ba lớp phòng thủ, đây là lớp thứ hai và thứ ba:
//
//   Lớp 1 (trong node.js): NodeCore chốt owner lúc khởi tạo, không đổi được.
//
//   Lớp 2: vòng đào mang theo owner và địa chỉ thợ đào của chính nó, rồi KIỂM
//          LẠI trước khi gọi acceptOwnBlock. Một block đào dở của account cũ sẽ
//          không bao giờ được ghi nhận cho account mới.
//
//   Lớp 3: hàng rào generation. Mỗi lần startNode tăng biến generation lên một.
//          Mọi callback bất đồng bộ đều so generation của mình với generation
//          hiện tại; lệch nhau là callback của node đã chết, bỏ qua ngay.
//
// LỖI ĐÃ TỪNG XẢY RA: chỉ setSession(null) khi đăng xuất mà không dừng vòng đào.
// Vòng đào cũ chạy tiếp, đào xong một block, và đúc coinbase cho account vừa
// đăng nhập. stopNode() bên dưới là thứ ngăn chuyện đó lặp lại.

import { createNode } from './node.js';
import { mineBlock } from './miner.js';

let generation = 0;
let active = null;

const RECONNECT_DELAY = 3000;
const HEARTBEAT_INTERVAL = 15000;

// --- TẠM: dụng cụ chẩn đoán kết nối. Xoá sau khi tìm ra nguyên nhân. ---------
// Chỉ in log, KHÔNG đổi hành vi: không đóng socket, không đổi state, không tự
// thử lại. Mốc thời gian tính từ lúc app khởi động để đọc được khoảng cách giữa
// các sự kiện.
const T0 = Date.now();
// Bao lâu thì coi như socket "treo ở CONNECTING" và in ra một dòng nhắc.
const PROBE_AFTER = 8000;
let attemptCount = 0;

function net(...args) {
  console.log(`[NET +${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...args);
}

const READY_STATE = ['CONNECTING(0)', 'OPEN(1)', 'CLOSING(2)', 'CLOSED(3)'];

function readyStateOf(socket) {
  if (!socket) return 'no-socket';
  return READY_STATE[socket.readyState] ?? `unknown(${socket.readyState})`;
}
// --- HẾT phần chẩn đoán ------------------------------------------------------

function isCurrent(context) {
  return context.generation === generation && active === context && !context.node.stopped;
}

export function getActiveNode() {
  return active ? active.node : null;
}

export function getActiveOwner() {
  return active ? active.owner : null;
}

export function isMining() {
  return active ? active.mining : false;
}

export function getConnectionState() {
  return active ? active.connection : 'offline';
}

// Dừng HẲN node: vòng đào, heartbeat, WebSocket. Gọi khi đăng xuất hoặc trước
// khi khởi động node của account khác.
export async function stopNode() {
  const context = active;
  active = null;
  generation++;
  if (!context) return;

  context.mining = false;
  context.node.stop();
  if (context.heartbeat) clearInterval(context.heartbeat);
  if (context.reconnectTimer) clearTimeout(context.reconnectTimer);
  if (context.socket) {
    try {
      context.socket.onclose = null;
      context.socket.onmessage = null;
      context.socket.onerror = null;
      context.socket.close();
    } catch {
      // Socket có thể đã đóng sẵn — không có gì để xử lý.
    }
  }
  context.connection = 'offline';
}

export async function startNode({ owner, relayUrl, storage, onState }) {
  net('startNode — relayUrl nhận được:', JSON.stringify(relayUrl), '| owner:', owner);
  await stopNode();

  const context = {
    generation,
    owner,
    relayUrl,
    mining: false,
    connection: 'offline',
    socket: null,
    heartbeat: null,
    reconnectTimer: null,
    onState,
    hashRate: 0,
  };

  context.node = createNode({
    owner,
    storage,
    onEvent: (event) => {
      // Hàng rào generation: sự kiện của node đã chết bị chặn ở đây.
      if (!isCurrent(context)) return;
      publish(context, event);
    },
  });

  active = context;
  await context.node.load();
  publish(context, { type: 'ready' });
  connect(context);
  return context.node;
}

function publish(context, event) {
  if (!isCurrent(context)) return;
  if (context.onState) {
    context.onState({
      owner: context.owner,
      connection: context.connection,
      mining: context.mining,
      height: context.node.getHeight(),
      mempool: context.node.getMempool().length,
      balance: context.node.getBalance(),
      mined: context.node.getMinedCount(),
      hashRate: context.hashRate,
      event,
    });
  }
}

// ---------------------------------------------------------------------------
// Mạng
// ---------------------------------------------------------------------------

function send(context, message) {
  if (!isCurrent(context)) return;
  if (!context.socket || context.socket.readyState !== 1) return;
  try {
    context.socket.send(JSON.stringify(message));
  } catch {
    // Mất kết nối giữa chừng — vòng reconnect sẽ lo.
  }
}

function connect(context) {
  if (!isCurrent(context) || !context.relayUrl) {
    net('connect() THOÁT SỚM — isCurrent:', isCurrent(context), '| relayUrl:', JSON.stringify(context.relayUrl));
    return;
  }

  context.connection = 'connecting';
  publish(context, { type: 'connection' });

  const attempt = ++attemptCount;
  net(`lần thử #${attempt} — sắp gọi new WebSocket(${JSON.stringify(context.relayUrl)})`);

  let socket;
  try {
    socket = new WebSocket(context.relayUrl);
  } catch (e) {
    net(`#${attempt} new WebSocket() NÉM LỖI ngay:`, e && e.message);
    scheduleReconnect(context);
    return;
  }
  context.socket = socket;
  net(`#${attempt} đã tạo socket, readyState =`, readyStateOf(socket));

  // Chỉ để chẩn đoán: nếu sau PROBE_AFTER mà chưa có sự kiện nào, in ra readyState.
  // KHÔNG đóng socket, KHÔNG đổi state — chỉ nói cho ta biết nó đang nằm ở đâu.
  let settled = false;
  const probe = setTimeout(() => {
    if (settled) return;
    net(
      `#${attempt} SAU ${PROBE_AFTER / 1000}s VẪN CHƯA CÓ SỰ KIỆN NÀO.`,
      'readyState =', readyStateOf(socket),
      '| context.connection =', context.connection
    );
  }, PROBE_AFTER);

  socket.onopen = () => {
    settled = true;
    clearTimeout(probe);
    net(`#${attempt} onopen — isCurrent:`, isCurrent(context));
    if (!isCurrent(context)) {
      socket.close();
      return;
    }
    context.connection = 'online';
    publish(context, { type: 'connection' });
    // Xin chuỗi của mạng ngay khi vào. Luật chuỗi dài nhất sẽ quyết định giữ cái nào.
    send(context, { kind: 'request-chain' });

    context.heartbeat = setInterval(() => {
      if (!isCurrent(context)) return;
      send(context, { kind: 'ping' });
    }, HEARTBEAT_INTERVAL);
  };

  socket.onmessage = async (raw) => {
    if (!isCurrent(context)) return;
    let message;
    try {
      message = JSON.parse(raw.data);
    } catch {
      return;
    }
    await handleMessage(context, message);
  };

  socket.onerror = (e) => {
    settled = true;
    clearTimeout(probe);
    net(
      `#${attempt} onerror — message:`, (e && (e.message || e.reason)) ?? '(không có)',
      '| readyState =', readyStateOf(socket),
      '| isCurrent:', isCurrent(context),
      '| LƯU Ý: nhánh này KHÔNG gọi scheduleReconnect'
    );
    if (!isCurrent(context)) return;
    context.connection = 'error';
    publish(context, { type: 'connection' });
  };

  socket.onclose = (e) => {
    settled = true;
    clearTimeout(probe);
    net(
      `#${attempt} onclose — code:`, e && e.code,
      '| reason:', JSON.stringify(e && e.reason),
      '| wasClean:', e && e.wasClean,
      '| isCurrent:', isCurrent(context)
    );
    if (!isCurrent(context)) return;
    if (context.heartbeat) clearInterval(context.heartbeat);
    context.connection = 'offline';
    publish(context, { type: 'connection' });
    scheduleReconnect(context);
  };
}

function scheduleReconnect(context) {
  if (!isCurrent(context)) {
    net('scheduleReconnect BỊ BỎ QUA vì isCurrent = false → VÒNG THỬ LẠI CHẾT TẠI ĐÂY');
    return;
  }
  net(`hẹn thử lại sau ${RECONNECT_DELAY / 1000}s`);
  context.reconnectTimer = setTimeout(() => {
    if (!isCurrent(context)) {
      net('tới giờ thử lại nhưng isCurrent = false → BỎ, vòng thử lại dừng');
      return;
    }
    connect(context);
  }, RECONNECT_DELAY);
}

// Zero-trust: mọi gói tin đến đều đi qua đủ bộ luật của node mình. Relay là relay
// câm, nó không kiểm gì cả, nên không có lý do gì để tin nội dung nó chuyển tới.
async function handleMessage(context, message) {
  if (!message || typeof message.kind !== 'string') return;

  if (message.kind === 'tx') {
    await context.node.receiveTransaction(message.tx);
    return;
  }
  if (message.kind === 'block') {
    const result = await context.node.receiveBlock(message.block);
    // Block mồ côi: xin lại toàn chuỗi để biết mình có đang ở nhánh ngắn không.
    if (!result.ok && result.reason === 'orphan') {
      send(context, { kind: 'request-chain' });
    }
    return;
  }
  if (message.kind === 'chain') {
    await context.node.receiveChain(message.chain);
    return;
  }
  if (message.kind === 'request-chain') {
    send(context, { kind: 'chain', chain: context.node.getChain() });
  }
}

export function broadcastTransaction(tx) {
  if (!active) return;
  send(active, { kind: 'tx', tx });
}

export function broadcastBlock(block) {
  if (!active) return;
  send(active, { kind: 'block', block });
}

export function requestChain() {
  if (!active) return;
  send(active, { kind: 'request-chain' });
}

// ---------------------------------------------------------------------------
// Đào
// ---------------------------------------------------------------------------

export function startMining() {
  const context = active;
  if (!context || context.mining) return;
  context.mining = true;
  publish(context, { type: 'mining' });
  void miningLoop(context);
}

export function stopMining() {
  if (!active) return;
  active.mining = false;
  publish(active, { type: 'mining' });
}

async function miningLoop(context) {
  // Chụp lại owner và địa chỉ thợ đào NGAY LÚC BẮT ĐẦU vòng lặp. Đây là lớp
  // phòng thủ thứ hai: kể cả khi biến toàn cục bị thay đổi giữa chừng, block đào
  // ra vẫn mang địa chỉ của đúng account đã khởi động vòng đào này.
  const minerAddress = context.owner;
  const myGeneration = context.generation;

  while (context.mining && isCurrent(context) && myGeneration === generation) {
    const block = await mineBlock({
      chain: context.node.getChain(),
      mempool: context.node.getMempool(),
      minerAddress,
      shouldContinue: () =>
        context.mining && myGeneration === generation && active === context && !context.node.stopped,
      onProgress: (attempts) => {
        context.hashRate = attempts;
      },
    });

    // Vòng đào bị cắt giữa chừng vì đăng xuất hoặc đổi account.
    if (!block) return;

    // KIỂM LẠI trước khi ghi nhận. Ba điều kiện phải cùng đúng.
    if (myGeneration !== generation || active !== context || context.node.stopped) return;
    if (block.miner !== minerAddress || context.node.owner !== minerAddress) return;

    const result = await context.node.acceptOwnBlock(block);
    if (result.ok) {
      broadcastBlock(block);
      publish(context, { type: 'mined', index: block.index });
    }
  }
}
