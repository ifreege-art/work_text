import assert from 'node:assert/strict';
import { calc, stableStringify } from '../public/js/core.js';

const base = (o) => ({ items: [{ name: 'a', qty: 1, unit: 10000 }], tax: { mode: 'exclusive', rate: 10, rounding: 'floor' }, withholding: { enabled: false }, ...o });

// 税抜入力
let t = calc(base({}));
assert.deepEqual([t.net, t.tax, t.gross, t.withholding, t.payable], [10000, 1000, 11000, 0, 11000]);

// 税込入力: 11000円 -> 税1000
t = calc(base({ items: [{ qty: 1, unit: 11000 }], tax: { mode: 'inclusive', rate: 10, rounding: 'floor' } }));
assert.deepEqual([t.net, t.tax, t.gross], [10000, 1000, 11000]);

// 端数処理
t = calc(base({ items: [{ qty: 1, unit: 1005 }], tax: { mode: 'exclusive', rate: 10, rounding: 'ceil' } }));
assert.equal(t.tax, 101);
t = calc(base({ items: [{ qty: 1, unit: 1005 }], tax: { mode: 'exclusive', rate: 10, rounding: 'round' } }));
assert.equal(t.tax, 101);
t = calc(base({ items: [{ qty: 1, unit: 1005 }] }));
assert.equal(t.tax, 100);

// 源泉徴収(税抜に対して)
t = calc(base({ withholding: { enabled: true, mode: 'auto' } }));
assert.equal(t.withholding, 1021); assert.equal(t.payable, 11000 - 1021);
t = calc(base({ items: [{ qty: 1, unit: 1500000 }], withholding: { enabled: true, mode: 'auto' } }));
assert.equal(t.withholding, 102100 + 102100); // 100万*10.21% + 50万*20.42%
t = calc(base({ withholding: { enabled: true, mode: 'custom', rate: 5 } }));
assert.equal(t.withholding, 500);
t = calc(base({ items: [{ qty: 1, unit: 3333 }], withholding: { enabled: true, mode: 'auto' } }));
assert.equal(t.withholding, 340); // 340.3...

assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
console.log('ok');
