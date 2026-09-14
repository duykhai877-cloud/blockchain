// RELAY CÂM — chạy trên laptop: node relay/server.js
//
// Nhiệm vụ duy nhất: nhận gói tin từ một node và chuyển tiếp nguyên văn cho mọi
// node còn lại.
//
// RELAY KHÔNG:
//   - verify chữ ký hay bất kỳ luật đồng thuận nào
//   - giữ chuỗi, giữ mempool, giữ số dư
//   - đào block
//   - trả về lý do từ chối
//
// Vì relay không kiểm gì, mọi node nhận PHẢI tự validate lại toàn bộ. Đó là ý
// nghĩa của zero-trust trong dự án này: tin cậy nằm ở node, không nằm ở đường
// truyền. Cũng vì vậy mà banner báo lỗi trên màn Chuyển coin phải viết "Node của
// bạn từ chối" chứ không phải "Mạng đã từ chối" — relay câm không nói được gì.

const http = require('http');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = 3001;

let nextId = 1;
const clients = new Map();
const counters = { forwarded: 0, dropped: 0 };

function describe(kind, message) {
  if (kind === 'block') return `block #${message.block?.index}`;
  if (kind === 'chain') return `chain ${message.chain?.length} block`;
  if (kind === 'tx') return `tx ${message.tx?.type} ${message.tx?.amount ?? ''}`;
  return kind;
}

function localAddresses() {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}

// Trang trạng thái để kiểm tra nhanh bằng trình duyệt trên điện thoại:
// mở http://<ip-laptop>:3001 mà thấy chữ là mạng LAN đã thông.
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(
    [
      'RELAY CAM - dang chay',
      `Cong: ${PORT}`,
      `Node dang ket noi: ${clients.size}`,
      `Goi tin da chuyen tiep: ${counters.forwarded}`,
      '',
      'Dia chi dat vao muc Cai dat cua app:',
      ...localAddresses().map((ip) => `  ws://${ip}:${PORT}`),
    ].join('\n')
  );
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket, request) => {
  const id = nextId++;
  const peer = request.socket.remoteAddress;
  clients.set(socket, id);
  console.log(`[+] node #${id} vao mang (${peer}) — tong ${clients.size}`);

  socket.on('message', (data) => {
    // Chỉ đọc trường `kind` để ghi log. Nội dung còn lại chuyển tiếp nguyên văn,
    // không đụng vào, không sửa, không kiểm.
    let kind = '?';
    let parsed = null;
    try {
      parsed = JSON.parse(data.toString());
      kind = parsed.kind || '?';
    } catch {
      counters.dropped++;
      return;
    }

    // Ping chỉ để giữ kết nối sống, không cần chuyển tiếp cho ai.
    if (kind === 'ping') return;

    let sent = 0;
    for (const [client] of clients) {
      if (client === socket) continue;
      if (client.readyState !== client.OPEN) continue;
      client.send(data.toString());
      sent++;
    }
    counters.forwarded += sent;
    console.log(`    #${id} -> ${sent} node: ${describe(kind, parsed)}`);
  });

  socket.on('close', () => {
    clients.delete(socket);
    console.log(`[-] node #${id} roi mang — con ${clients.size}`);
  });

  socket.on('error', () => {
    clients.delete(socket);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('======================================');
  console.log(' RELAY CAM — chi chuyen tiep goi tin');
  console.log('======================================');
  console.log(`Cong ${PORT}. Dat mot trong cac dia chi sau vao muc Cai dat:`);
  for (const ip of localAddresses()) console.log(`   ws://${ip}:${PORT}`);
  console.log('Ca hai dien thoai phai cung mang Wi-Fi voi laptop.');
});
