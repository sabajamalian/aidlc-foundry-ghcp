import { api, check, expectEqual, run } from './lib.mjs';

if (!process.env.API_BASE_URL) throw new Error('API_BASE_URL is required');

async function withOrder(fn) {
  const created = await api('POST', '/api/orders', {
    branchId: 1,
    orderDate: new Date().toISOString(),
    name: `acceptance-pricing-${crypto.randomUUID()}`,
    description: 'Temporary pricing acceptance check',
    status: 'pending',
  });
  expectEqual(created.status, 201, 'create temporary order');
  const orderId = created.body.orderId;
  try {
    return await fn(orderId);
  } finally {
    const removed = await api('DELETE', `/api/orders/${orderId}`);
    expectEqual(removed.status, 204, 'clean up temporary order and lines');
  }
}

async function createLine(orderId, fields = {}) {
  const response = await api('POST', '/api/order-details', {
    orderId, productId: 1, quantity: 2, notes: 'acceptance-pricing', ...fields,
  });
  expectEqual(response.status, 201, 'create line');
  return response.body;
}

async function storedLine(id) {
  const response = await api('GET', `/api/order-details/${id}`);
  expectEqual(response.status, 200, 'read stored line');
  return response.body;
}

async function linesFor(orderId) {
  const response = await api('GET', '/api/order-details');
  expectEqual(response.status, 200, 'list lines');
  return response.body.filter((line) => line.orderId === orderId);
}

check('AC-1: Creating a line for product 1 (price 129.99, discount 0.25), quantity 2, without a client unitPrice returns and stores unitPrice 97.49.', () => withOrder(async (orderId) => {
  const line = await createLine(orderId);
  expectEqual(line.unitPrice, 97.49, 'returned unitPrice');
  expectEqual((await storedLine(line.orderDetailId)).unitPrice, 97.49, 'stored unitPrice');
}));

check('AC-2: A supplied unitPrice never overrides catalog pricing on creation. A direct unitPrice update cannot override the stored server price either.', () => withOrder(async (orderId) => {
  const line = await createLine(orderId, { unitPrice: 0.01 });
  expectEqual(line.unitPrice, 97.49, 'ignore client price on create');
  const updated = await api('PUT', `/api/order-details/${line.orderDetailId}`, { unitPrice: 0.01 });
  expectEqual(updated.status, 200, 'price-only update');
  expectEqual(updated.body.unitPrice, 97.49, 'ignore client price on update');
  expectEqual((await storedLine(line.orderDetailId)).unitPrice, 97.49, 'stored server price');
}));

check('AC-3: Product 3 with price 89.99 and discount 0 returns unitPrice 89.99.', () => withOrder(async (orderId) => {
  const line = await createLine(orderId, { productId: 3, quantity: 1 });
  expectEqual(line.unitPrice, 89.99, 'undiscounted unitPrice');
}));

check('AC-4: Both individual and list order reads include totalAmount. An order with two units of product 1 and one of product 3 returns 284.97; an empty order returns 0.', () => withOrder(async (orderId) => {
  await createLine(orderId);
  await createLine(orderId, { productId: 3, quantity: 1 });
  await withOrder(async (emptyId) => {
    for (const [id, total] of [[orderId, 284.97], [emptyId, 0]]) {
      const single = await api('GET', `/api/orders/${id}`);
      expectEqual(single.status, 200, 'read order');
      expectEqual(single.body.totalAmount, total, 'individual total');
      const list = await api('GET', '/api/orders');
      expectEqual(list.status, 200, 'list orders');
      expectEqual(list.body.find((order) => order.orderId === id)?.totalAmount, total, 'list total');
    }
  });
}));

check('AC-5: Creating or changing a line to an unknown product returns 404 and does not persist the change.', () => withOrder(async (orderId) => {
  const line = await createLine(orderId);
  const products = await api('GET', '/api/products');
  expectEqual(products.status, 200, 'list products');
  const missingId = Math.max(0, ...products.body.map((product) => product.productId)) + 1;
  const created = await api('POST', '/api/order-details', { orderId, productId: missingId, quantity: 1 });
  expectEqual(created.status, 404, 'unknown product on create');
  const updated = await api('PUT', `/api/order-details/${line.orderDetailId}`, { productId: missingId, quantity: 3 });
  expectEqual(updated.status, 404, 'unknown product on update');
  expectEqual(JSON.stringify(await storedLine(line.orderDetailId)), JSON.stringify(line), 'unchanged line');
  expectEqual((await linesFor(orderId)).length, 1, 'no extra rows');
}));

check('AC-6: Quantity must be a positive integer; invalid quantities return 400 without persisting changes.', () => withOrder(async (orderId) => {
  const line = await createLine(orderId);
  for (const quantity of [0, -1, 1.5, '2', null, undefined]) {
    const created = await api('POST', '/api/order-details', { orderId, productId: 1, quantity });
    expectEqual(created.status, 400, `invalid quantity ${quantity} on create`);
    if (quantity !== undefined) {
      const updated = await api('PUT', `/api/order-details/${line.orderDetailId}`, { quantity });
      expectEqual(updated.status, 400, `invalid quantity ${quantity} on update`);
    }
  }
  expectEqual(JSON.stringify(await storedLine(line.orderDetailId)), JSON.stringify(line), 'unchanged line');
  expectEqual((await linesFor(orderId)).length, 1, 'no invalid rows');
}));

check('AC-7: Changing productId recalculates the line price from that product. Quantity-only and notes-only updates preserve the stored price, even after catalog discounts change.', () => withOrder(async (orderId) => {
  const line = await createLine(orderId);
  for (const update of [{ quantity: 3 }, { notes: 'acceptance-updated' }, { productId: 1 }]) {
    const response = await api('PUT', `/api/order-details/${line.orderDetailId}`, update);
    expectEqual(response.status, 200, 'update without product change');
    expectEqual(response.body.unitPrice, 97.49, 'preserve stored price');
  }
  const replaced = await api('PUT', `/api/order-details/${line.orderDetailId}`, { productId: 3, unitPrice: 1 });
  expectEqual(replaced.status, 200, 'replace product');
  expectEqual(replaced.body.unitPrice, 89.99, 'replacement catalog price');
  return 'Catalog-change preservation is also covered by isolated repository and route tests; no catalog records were changed here.';
}));

await run();
