// Mã hoá / giải mã chữ ký ECDSA theo DER (ASN.1).
//
// TẠI SAO PHẢI TỰ VIẾT: @noble/secp256k1 v3 — bản cài được cho Expo SDK 54 —
// đã bỏ hẳn DER. Source của thư viện ghi rõ:
//   'Signature format "der" is not supported: switch to noble-curves'
// Ràng buộc dự án không cho thêm thư viện (noble-curves), nên bộ mã hoá DER
// nằm ở đây. Thư viện chỉ trả về compact 64 byte (r‖s), phần còn lại là ASN.1
// thuần tuý nên viết tay được và kiểm chứng được bằng test.
//
// TẠI SAO CHỌN DER CHO VÍ LOẠI S: đây là quyết định có chủ ý của dự án. Nếu cả
// hai loại ví cùng dùng compact thì chữ ký đều đúng 64 byte và không còn gì để
// so sánh. DER là định dạng Bitcoin dùng thật, độ dài thay đổi tuỳ giá trị r và
// s — chính sự thay đổi đó là thứ đáng cho người học nhìn thấy.
//
// ĐỘ DÀI THỰC TẾ: đặc tả ghi 70–72 byte, đó là khoảng thường gặp. Con số chính
// xác phụ thuộc r và s:
//   độ dài = 6 + len(r) + len(s)
// Thư viện bật lowS mặc định nên s luôn < n/2, byte đầu của s luôn < 0x80, tức
// len(s) = 32 và không bao giờ phải đệm. Còn r là số ngẫu nhiên:
//   - bit cao của r bật (xác suất 1/2)     -> len(r) = 33 -> tổng 71 byte
//   - bit cao tắt, không có byte 0 đầu     -> len(r) = 32 -> tổng 70 byte
//   - r có byte 0x00 ở đầu (xác suất 1/256) -> len(r) = 31 -> tổng 69 byte
// Nên 72 byte không xảy ra khi lowS bật, và 69 byte thì thỉnh thoảng có. UI phải
// hiện độ dài đo được từ chữ ký thật, không hardcode con số nào.
//
// Cấu trúc:
//   0x30 <tổng độ dài> 0x02 <độ dài r> <r> 0x02 <độ dài s> <s>
// r và s là số nguyên big-endian độ dài tối thiểu. Nếu byte đầu >= 0x80 thì
// phải chèn thêm 0x00 phía trước, vì ASN.1 INTEGER có dấu và nếu không chèn
// thì số dương sẽ bị đọc thành số âm.

import { concatBytes } from './bytes.js';

// Bỏ các byte 0x00 thừa ở đầu, rồi chèn lại 0x00 nếu bit cao của byte đầu bật.
function toDerInteger(bytes) {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.slice(start);
  const needsPad = (trimmed[0] & 0x80) !== 0;
  const body = needsPad ? concatBytes(new Uint8Array([0x00]), trimmed) : trimmed;
  return concatBytes(new Uint8Array([0x02, body.length]), body);
}

// compact 64 byte (r 32 byte ‖ s 32 byte) -> DER
export function compactToDer(compact) {
  if (compact.length !== 64) {
    throw new Error('Chữ ký compact phải đúng 64 byte');
  }
  const r = toDerInteger(compact.slice(0, 32));
  const s = toDerInteger(compact.slice(32, 64));
  const body = concatBytes(r, s);
  if (body.length > 0x7f) {
    // Không thể xảy ra với secp256k1: r và s tối đa 33 byte nên body tối đa 70.
    throw new Error('Thân DER quá dài');
  }
  return concatBytes(new Uint8Array([0x30, body.length]), body);
}

// Đọc một INTEGER tại vị trí offset, trả về { value, next }.
function readDerInteger(der, offset, label) {
  if (der[offset] !== 0x02) {
    throw new Error(`DER hỏng: thiếu thẻ INTEGER cho ${label}`);
  }
  const len = der[offset + 1];
  if (len === 0) throw new Error(`DER hỏng: ${label} rỗng`);
  const start = offset + 2;
  const end = start + len;
  if (end > der.length) throw new Error(`DER hỏng: ${label} vượt quá độ dài gói`);
  const raw = der.slice(start, end);
  // Số âm không hợp lệ với r/s.
  if ((raw[0] & 0x80) !== 0) throw new Error(`DER hỏng: ${label} là số âm`);
  // 0x00 ở đầu chỉ được phép khi byte kế tiếp có bit cao bật.
  if (raw.length > 1 && raw[0] === 0x00 && (raw[1] & 0x80) === 0) {
    throw new Error(`DER hỏng: ${label} có byte đệm thừa`);
  }
  let value = raw;
  while (value.length > 32 && value[0] === 0x00) value = value.slice(1);
  if (value.length > 32) throw new Error(`DER hỏng: ${label} dài hơn 32 byte`);
  return { value, next: end };
}

// DER -> compact 64 byte. Ném lỗi nếu gói sai cấu trúc.
export function derToCompact(der) {
  if (der.length < 8) throw new Error('DER hỏng: gói quá ngắn');
  if (der[0] !== 0x30) throw new Error('DER hỏng: thiếu thẻ SEQUENCE');
  if (der[1] !== der.length - 2) throw new Error('DER hỏng: độ dài không khớp');
  const r = readDerInteger(der, 2, 'r');
  const s = readDerInteger(der, r.next, 's');
  if (s.next !== der.length) throw new Error('DER hỏng: còn byte thừa ở cuối');
  const out = new Uint8Array(64);
  out.set(r.value, 32 - r.value.length);
  out.set(s.value, 64 - s.value.length);
  return out;
}
