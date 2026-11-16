import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { closeDatabase, getDatabase } from '../db/sqlite';
import { runMigrations } from '../db/migrate';
import { errorHandler } from '../utils/errors';
import orderDetailRouter from './orderDetail';
import orderRouter from './order';

let app: express.Express;
const line = { orderId: 1, productId: 1, quantity: 2 };

beforeEach(async () => {
  await closeDatabase();
  const db = await getDatabase(true);
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
  await db.run(
    'INSERT INTO orders (order_id, branch_id, order_date, name) VALUES (?, ?, ?, ?)',
    [1, 1, '2026-01-01', 'Order'],
  );
  app = express();
  app.use(express.json());
  app.use('/order-details', orderDetailRouter);
  app.use('/orders', orderRouter);
  app.use(errorHandler);
});

afterEach(async () => { await closeDatabase(); });

describe('order pricing API', () => {
  it('creates server-priced lines with and without a legacy client price', async () => {
    for (const input of [line, { ...line, unitPrice: 0.01 }]) {
      const response = await request(app).post('/order-details').send(input);
      expect(response.status).toBe(201);
      expect(response.body.unitPrice).toBe(97.49);
      const stored = await request(app).get(`/order-details/${response.body.orderDetailId}`);
      expect(stored.body.unitPrice).toBe(97.49);
      const tampered = await request(app).put(`/order-details/${response.body.orderDetailId}`)
        .send({ unitPrice: 0.01 });
      expect(tampered.status).toBe(200);
      expect(tampered.body.unitPrice).toBe(97.49);
    }
    const fullPrice = await request(app).post('/order-details').send({ ...line, productId: 3 });
    expect(fullPrice.body.unitPrice).toBe(89.99);
  });

  it.each([0, -1, 1.5, '2', null, undefined])(
    'returns 400 for invalid quantity %s without changing stored data',
    async (quantity) => {
      const created = await request(app).post('/order-details').send(line);
      const failedCreate = await request(app).post('/order-details').send({ ...line, quantity });
      expect(failedCreate.status).toBe(400);
      expect(failedCreate.body.error.code).toBe('VALIDATION_ERROR');
      if (quantity !== undefined) {
        const failedUpdate = await request(app).put(`/order-details/${created.body.orderDetailId}`)
          .send({ quantity, notes: 'Rejected' });
        expect(failedUpdate.status).toBe(400);
      }
      const stored = await request(app).get('/order-details');
      expect(stored.body).toEqual([created.body]);
    },
  );

  it('returns 404 for missing products on both writes and preserves the existing row', async () => {
    const created = await request(app).post('/order-details').send(line);
    const rejectedCreate = await request(app).post('/order-details').send({ ...line, productId: 999 });
    const rejectedUpdate = await request(app).put(`/order-details/${created.body.orderDetailId}`)
      .send({ productId: 999, quantity: 3 });
    expect(rejectedCreate.status).toBe(404);
    expect(rejectedUpdate.status).toBe(404);
    expect(rejectedUpdate.body.error.message).toContain('Product');
    const stored = await request(app).get('/order-details');
    expect(stored.body).toEqual([created.body]);
    expect((await request(app).put('/order-details/999').send({ quantity: 1 })).status).toBe(404);
    expect((await request(app).get('/orders/999')).status).toBe(404);
  });

  it('changes price only when the product changes, even after a catalog edit', async () => {
    const created = await request(app).post('/order-details').send(line);
    const path = `/order-details/${created.body.orderDetailId}`;
    const db = await getDatabase();
    await db.run('UPDATE products SET discount = ? WHERE product_id = ?', [0.5, 1]);
    for (const update of [{ quantity: 3 }, { notes: 'Keep price' }, { productId: 1 }]) {
      const response = await request(app).put(path).send(update);
      expect(response.status).toBe(200);
      expect(response.body.unitPrice).toBe(97.49);
    }
    const replaced = await request(app).put(path).send({ productId: 3, unitPrice: 1 });
    expect(replaced.status).toBe(200);
    expect(replaced.body.unitPrice).toBe(89.99);
  });

  it('rejects unsupported amounts and serializes concurrent cumulative-total validation', async () => {
    const overflow = await request(app).post('/order-details')
      .send({ ...line, quantity: 1_000_000_000_000 });
    expect(overflow.status).toBe(400);
    const responses = await Promise.all([
      request(app).post('/order-details').send({ ...line, quantity: 500_000_000_000 }),
      request(app).post('/order-details').send({ ...line, quantity: 500_000_000_000 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
    const rows = await request(app).get('/order-details');
    expect(rows.body).toHaveLength(1);
    const total = await request(app).get('/orders/1');
    expect(total.status).toBe(200);
    expect(total.body.totalAmount).toBe(48_745_000_000_000);
  });

  it('returns totals for single and list reads, including empty orders', async () => {
    await request(app).post('/order-details').send(line);
    await request(app).post('/order-details').send({ ...line, productId: 3, quantity: 1 });
    const empty = await request(app).post('/orders').send({
      branchId: 1, orderDate: '2026-01-01', name: 'Empty', totalAmount: 999,
    });
    expect(empty.status).toBe(201);
    expect(empty.body.totalAmount).toBe(0);
    const single = await request(app).get('/orders/1');
    expect(single.status).toBe(200);
    expect(single.body.totalAmount).toBe(284.97);
    const list = await request(app).get('/orders');
    expect(list.status).toBe(200);
    expect(list.body.map((entry: { totalAmount: number }) => entry.totalAmount)).toEqual([284.97, 0]);
    const echoed = await request(app).put('/orders/1').send({ ...single.body, name: 'Renamed' });
    expect(echoed.status).toBe(200);
    expect(echoed.body.totalAmount).toBe(284.97);
  });
});
