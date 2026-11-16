/**
 * Repository for orders data access
 */

import { getDatabase, DatabaseConnection } from '../db/sqlite';
import { Order, OrderInput } from '../models/order';
import { handleDatabaseError, NotFoundError } from '../utils/errors';
import { buildInsertSQL, buildUpdateSQL, objectToCamelCase, DatabaseRow } from '../utils/sql';
import { orderTotal } from '../utils/pricing';

export class OrdersRepository {
  private db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  private async findWithTotals(
    where: string = '',
    params: unknown[] = [],
    orderBy: string = 'o.order_id',
  ): Promise<Order[]> {
    const rows = await this.db.all<DatabaseRow & {
      line_quantity: number | null;
      line_unit_price: number | null;
    }>(
      `SELECT o.*, d.quantity AS line_quantity, d.unit_price AS line_unit_price
       FROM orders o LEFT JOIN order_details d ON d.order_id = o.order_id
       ${where} ORDER BY ${orderBy}, d.order_detail_id`,
      params,
    );
    const grouped = new Map<number, {
      order: Order;
      lines: { quantity: number; unitPrice: number }[];
    }>();
    for (const { line_quantity, line_unit_price, ...fields } of rows) {
      const order = objectToCamelCase<Omit<Order, 'totalAmount'>>(fields);
      let group = grouped.get(order.orderId);
      if (!group) {
        group = { order: { ...order, totalAmount: 0 }, lines: [] };
        grouped.set(order.orderId, group);
      }
      if (line_quantity !== null && line_unit_price !== null) {
        group.lines.push({ quantity: line_quantity, unitPrice: line_unit_price });
      }
    }
    return [...grouped.values()].map(({ order, lines }) => ({
      ...order,
      totalAmount: orderTotal(lines),
    }));
  }

  private writableFields(order: Partial<OrderInput>): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const key of ['branchId', 'orderDate', 'name', 'description', 'status'] as const) {
      if (order[key] !== undefined) fields[key] = order[key];
    }
    return fields;
  }

  /**
   * Get all orders
   */
  async findAll(): Promise<Order[]> {
    try {
      return await this.findWithTotals();
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Get order by ID
   */
  async findById(id: number): Promise<Order | null> {
    try {
      const orders = await this.findWithTotals('WHERE o.order_id = ?', [id]);
      return orders[0] ?? null;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Create a new order
   */
  async create(order: OrderInput): Promise<Order> {
    try {
      const { sql, values } = buildInsertSQL('orders', this.writableFields(order));
      const result = await this.db.run(sql, values);

      const createdOrder = await this.findById(result.lastID || 0);
      if (!createdOrder) {
        throw new Error('Failed to retrieve created order');
      }

      return createdOrder;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Update order by ID
   */
  async update(id: number, order: Partial<OrderInput>): Promise<Order> {
    try {
      const fields = this.writableFields(order);
      if (Object.keys(fields).length === 0) {
        const existing = await this.findById(id);
        if (!existing) throw new NotFoundError('Order', id);
        return existing;
      }
      const { sql, values } = buildUpdateSQL('orders', fields, 'order_id = ?');
      const result = await this.db.run(sql, [...values, id]);

      if (result.changes === 0) {
        throw new NotFoundError('Order', id);
      }

      const updatedOrder = await this.findById(id);
      if (!updatedOrder) {
        throw new Error('Failed to retrieve updated order');
      }

      return updatedOrder;
    } catch (error) {
      handleDatabaseError(error, 'Order', id);
    }
  }

  /**
   * Delete order by ID
   */
  async delete(id: number): Promise<void> {
    try {
      const result = await this.db.run('DELETE FROM orders WHERE order_id = ?', [id]);

      if (result.changes === 0) {
        throw new NotFoundError('Order', id);
      }
    } catch (error) {
      handleDatabaseError(error, 'Order', id);
    }
  }

  /**
   * Check if order exists
   */
  async exists(id: number): Promise<boolean> {
    try {
      const result = await this.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM orders WHERE order_id = ?',
        [id],
      );
      return (result?.count || 0) > 0;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Find orders by branch ID
   */
  async findByBranchId(branchId: number): Promise<Order[]> {
    try {
      return await this.findWithTotals('WHERE o.branch_id = ?', [branchId], 'o.order_date DESC');
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Find orders by status
   */
  async findByStatus(status: string): Promise<Order[]> {
    try {
      return await this.findWithTotals('WHERE o.status = ?', [status], 'o.order_date DESC');
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Find orders by date range
   */
  async findByDateRange(startDate: string, endDate: string): Promise<Order[]> {
    try {
      return await this.findWithTotals(
        'WHERE o.order_date >= ? AND o.order_date <= ?',
        [startDate, endDate], 'o.order_date DESC',
      );
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}

// Factory function to create repository instance
export async function createOrdersRepository(isTest: boolean = false): Promise<OrdersRepository> {
  const db = await getDatabase(isTest);
  return new OrdersRepository(db);
}

// Singleton instance for default usage
let ordersRepo: OrdersRepository | null = null;

export async function getOrdersRepository(isTest: boolean = false): Promise<OrdersRepository> {
  const isTestEnv = isTest || process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (isTestEnv) {
    return createOrdersRepository(true);
  }
  if (!ordersRepo) {
    ordersRepo = await createOrdersRepository(false);
  }
  return ordersRepo;
}
