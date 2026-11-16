import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, DatabaseConnection, getDatabase } from '../db/sqlite';
import { runMigrations } from '../db/migrate';
import { NotFoundError, ValidationError } from '../utils/errors';
import { OrderDetailsRepository } from './orderDetailsRepo';
import { OrdersRepository } from './ordersRepo';

let db: DatabaseConnection;
let details: OrderDetailsRepository;
let orders: OrdersRepository;
const line = { orderId: 1, productId: 1, quantity: 2 };
const order = {
  branchId: 1, orderDate: '2026-01-01', name: 'Test order', description: '', status: 'pending',
};

beforeEach(async () => {
  await closeDatabase();
  db = await getDatabase(true);
  await runMigrations(true);
  await db.run('INSERT INTO headquarters (headquarters_id, name) VALUES (?, ?)', [1, 'HQ']);
  await db.run('INSERT INTO branches (branch_id, headquarters_id, name) VALUES (?, ?, ?)', [1, 1, 'Branch']);
  await db.run('INSERT INTO suppliers (supplier_id, name) VALUES (?, ?)', [1, 'Supplier']);
  for (const [id, price, discount] of [[1, 129.99, 0.25], [3, 89.99, 0]]) {
    await db.run(
      'INSERT INTO products (product_id, supplier_id, name, price, discount, sku, unit) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, 1, `Product ${id}`, price, discount, `SKU-${id}`, 'each'],
    );
  }
  details = new OrderDetailsRepository(db);
  orders = new OrdersRepository(db);
  await orders.create(order);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeDatabase();
});

describe('catalog-priced order lines', () => {
  it('snapshots the catalog price without a client price and ignores extra fields', async () => {
    const input = { ...line, orderDetailId: 999, unit_price: 1 };
    const created = await details.create(input);
    expect(created.unitPrice).toBe(97.49);
    expect(created.orderDetailId).not.toBe(999);
    expect((await details.findById(created.orderDetailId))?.unitPrice).toBe(97.49);
    expect((await details.create({ ...line, productId: 3 }))?.unitPrice).toBe(89.99);
  });

  it('ignores client pricing on create and price-only updates', async () => {
    const created = await details.create({ ...line, unitPrice: 0.01 });
    expect(created.unitPrice).toBe(97.49);
    expect(await details.update(created.orderDetailId, { unitPrice: 0.01 })).toEqual(created);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects quantity %s before either write',
    async (quantity) => {
      const created = await details.create(line);
      await expect(details.create({ ...line, quantity })).rejects.toThrow(ValidationError);
      await expect(details.update(created.orderDetailId, { quantity, notes: 'Rejected' }))
        .rejects.toThrow(ValidationError);
      expect(await details.findAll()).toEqual([created]);
    },
  );

  it('does not persist unknown products on create or update', async () => {
    const created = await details.create(line);
    await expect(details.create({ ...line, productId: 999 })).rejects.toThrow(NotFoundError);
    await expect(details.update(created.orderDetailId, { productId: 999, quantity: 3 }))
      .rejects.toThrow(NotFoundError);
    expect(await details.findAll()).toEqual([created]);
    await expect(details.update(999, { quantity: 1 })).rejects.toThrow(NotFoundError);
  });

  it('preserves historical prices unless the product actually changes', async () => {
    const created = await details.create(line);
    await db.run('UPDATE products SET discount = ? WHERE product_id = ?', [0.5, 1]);
    expect((await details.update(created.orderDetailId, { quantity: 3 })).unitPrice).toBe(97.49);
    expect((await details.update(created.orderDetailId, { notes: 'Keep price' })).unitPrice).toBe(97.49);
    expect((await details.update(created.orderDetailId, { productId: 1 })).unitPrice).toBe(97.49);
    expect((await orders.findById(1))?.totalAmount).toBe(292.47);
    expect((await details.update(created.orderDetailId, { productId: 3, unitPrice: 1 })).unitPrice).toBe(89.99);
    expect((await details.update(created.orderDetailId, { productId: 1 })).unitPrice).toBe(65);
  });

  it('rejects unsupported line amounts before creating or changing quantities', async () => {
    const created = await details.create(line);
    await expect(details.create({ ...line, quantity: 1_000_000_000_000 }))
      .rejects.toThrow(ValidationError);
    await expect(details.update(created.orderDetailId, { quantity: 1_000_000_000_000 }))
      .rejects.toThrow(ValidationError);
    expect(await details.findAll()).toEqual([created]);
    expect((await orders.findById(1))?.totalAmount).toBe(194.98);
  });

  it('rejects a product change that would overflow the stored line amount', async () => {
    const created = await details.create({ ...line, productId: 3, quantity: 1_000_000_000_000 });
    await expect(details.update(created.orderDetailId, { productId: 1 }))
      .rejects.toThrow(ValidationError);
    expect(await details.findById(created.orderDetailId)).toEqual(created);
    expect((await orders.findById(1))?.totalAmount).toBe(89_990_000_000_000);
  });

  it('rejects cumulative overflow on create and moves without persisting either change', async () => {
    const first = await details.create({ ...line, quantity: 500_000_000_000 });
    await expect(details.create({ ...line, quantity: 500_000_000_000 }))
      .rejects.toThrow(ValidationError);
    const secondOrder = await orders.create({ ...order, name: 'Other order' });
    const second = await details.create({ ...line, orderId: secondOrder.orderId, quantity: 500_000_000_000 });
    await expect(details.update(second.orderDetailId, { orderId: 1 })).rejects.toThrow(ValidationError);
    expect(await details.findAll()).toEqual([first, second]);
    expect((await orders.findAll()).map((entry) => entry.totalAmount))
      .toEqual([48_745_000_000_000, 48_745_000_000_000]);
  });
});

describe('order totals', () => {
  it('includes exact totals and empty orders in every read without N+1 queries', async () => {
    await details.create(line);
    await details.create({ ...line, productId: 3, quantity: 1 });
    const empty = await orders.create({ ...order, name: 'Empty order', orderDate: '2026-01-02' });
    const all = vi.spyOn(db, 'all');
    const result = await orders.findAll();
    expect(all).toHaveBeenCalledTimes(1);
    expect(result.map((entry) => entry.totalAmount)).toEqual([284.97, 0]);
    expect(result[0]).not.toHaveProperty('lineQuantity');
    expect((await orders.findById(1))?.totalAmount).toBe(284.97);
    expect((await orders.findById(empty.orderId))?.totalAmount).toBe(0);
    expect(await orders.findById(999)).toBeNull();
    expect((await orders.findByBranchId(1)).map((entry) => entry.totalAmount)).toEqual([0, 284.97]);
    expect((await orders.findByStatus('pending')).map((entry) => entry.totalAmount)).toEqual([0, 284.97]);
    expect((await orders.findByDateRange('2026-01-01', '2026-01-02')).map((entry) => entry.totalAmount))
      .toEqual([0, 284.97]);
    expect(await details.getTotalValueByOrderId(1)).toBe(284.97);
  });

  it('ignores computed totals on writes, including an echoed order response', async () => {
    const input = { ...order, totalAmount: 123 };
    const created = await orders.create(input);
    expect(created.totalAmount).toBe(0);
    expect((await orders.update(created.orderId, { ...created, name: 'Renamed' })).name).toBe('Renamed');
    expect((await orders.update(created.orderId, { ...created })).totalAmount).toBe(0);
  });
});
