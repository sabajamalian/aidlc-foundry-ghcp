// ILLUSTRATIVE EXAMPLE. In a real run the implementer agent writes
// acceptance/proposal-<N>.mjs from the approved proposal. This file mirrors the
// sample proposal in 01-discovery-output.json so you can see the expected shape.
// Run it against a build that includes the fix:
//   API_BASE_URL=http://localhost:3000 node docs/agentic-sdlc/sample-run/proposal-example.mjs
import { api, check, expectEqual, run } from '../../../acceptance/lib.mjs';

const created = { orders: [], details: [] };

async function newOrder() {
  const res = await api('POST', '/api/orders', {
    branchId: 1,
    orderDate: new Date().toISOString(),
    name: `acceptance-${Date.now()}`,
    description: 'acceptance check, safe to delete',
    status: 'pending',
  });
  expectEqual(res.status, 201, 'create order status');
  created.orders.push(res.body.orderId);
  return res.body.orderId;
}

async function addLine(orderId, productId, quantity, unitPrice) {
  const res = await api('POST', '/api/order-details', { orderId, productId, quantity, unitPrice, notes: 'acceptance' });
  if (res.status === 201) created.details.push(res.body.orderDetailId);
  return res;
}

check('AC-1: discounted product line uses catalog price minus discount, rounded to cents', async () => {
  const res = await addLine(await newOrder(), 1, 2);
  expectEqual(res.status, 201, 'status');
  expectEqual(res.body.unitPrice, 97.49, 'unitPrice');
  return 'SmartFeeder One -> 97.49';
});

check('AC-2: client-supplied unitPrice is ignored', async () => {
  const res = await addLine(await newOrder(), 1, 1, 1.0);
  expectEqual(res.body.unitPrice, 97.49, 'unitPrice');
  return 'sent 1.00, stored 97.49';
});

check('AC-3: undiscounted product keeps list price', async () => {
  const res = await addLine(await newOrder(), 3, 1);
  expectEqual(res.body.unitPrice, 89.99, 'unitPrice');
});

check('AC-4: GET /api/orders/{id} returns totalAmount', async () => {
  const orderId = await newOrder();
  await addLine(orderId, 1, 2);
  await addLine(orderId, 3, 1);
  const res = await api('GET', `/api/orders/${orderId}`);
  expectEqual(res.body.totalAmount, 284.97, 'totalAmount');
  return 'totalAmount 284.97';
});

check('AC-5: unknown product returns 404 and stores nothing', async () => {
  const res = await addLine(await newOrder(), 999999, 1);
  expectEqual(res.status, 404, 'status');
});

try {
  await run();
} finally {
  for (const id of created.details) await api('DELETE', `/api/order-details/${id}`);
  for (const id of created.orders) await api('DELETE', `/api/orders/${id}`);
}
