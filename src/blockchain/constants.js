// Hằng số đồng thuận. Hai máy lệch nhau một giá trị ở đây là không bao giờ
// đồng bộ được chuỗi, nên tất cả gom về một chỗ.

export const DIFFICULTY = 3;
export const DIFFICULTY_PREFIX = '0'.repeat(DIFFICULTY);

// Thưởng đào. Hardcode để thợ đào không tự đặt số tiền cho mình.
export const COINBASE_REWARD = 50;

// Faucet cấp đúng 100 coin, một lần cho mỗi địa chỉ.
export const FAUCET_AMOUNT = 100;

export const TX_COINBASE = 'COINBASE';
export const TX_FAUCET = 'FAUCET';
export const TX_TRANSFER = 'TRANSFER';

// Genesis phải HARDCODE timestamp. Nếu sinh bằng Date.now() thì hai máy có
// genesis khác nhau, hash khác nhau, và không bao giờ nối được chuỗi với nhau.
export const GENESIS_TIMESTAMP = 1755331200000;
export const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

export const MAX_TX_PER_BLOCK = 20;
