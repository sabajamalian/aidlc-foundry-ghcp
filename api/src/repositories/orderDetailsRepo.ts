/**
 * Repository for order details data access
 */

import { getDatabase, DatabaseConnection } from '../db/sqlite';
import { OrderDetail, OrderDetailInput } from '../models/orderDetail';
import { handleDatabaseError, NotFoundError, ValidationError } from '../utils/errors';
import { buildInsertSQL, buildUpdateSQL, objectToCamelCase, mapDatabaseRows, DatabaseRow } from '../utils/sql';
import { discountedUnitPrice, orderTotal } from '../utils/pricing';

export class OrderDetailsRepository {
  private db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  /**
   * Get all order details
   */
  async findAll(): Promise<OrderDetail[]> {
    try {
      const rows = await this.db.all<DatabaseRow>('SELECT * FROM order_details ORDER BY order_detail_id');
      return mapDatabaseRows<OrderDetail>(rows);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Get order detail by ID
   */
  async findById(id: number): Promise<OrderDetail | null> {
    try {
      const row = await this.db.get<DatabaseRow>('SELECT * FROM order_details WHERE order_detail_id = ?', [
        id,
      ]);
      return row ? objectToCamelCase<OrderDetail>(row) : null;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Create a new order detail
   */
  async create(orderDetail: OrderDetailInput): Promise<OrderDetail> {
    try {
      this.validateInput(orderDetail);
      this.validateQuantity(orderDetail.quantity);
      return this.db.db.transaction(() => {
        const fields = {
          orderId: orderDetail.orderId,
          productId: orderDetail.productId,
          quantity: orderDetail.quantity,
          unitPrice: this.catalogPrice(orderDetail.productId),
          notes: orderDetail.notes ?? '',
        };
        this.validateOrderTotal(fields);
        const { sql, values } = buildInsertSQL('order_details', fields);
        const result = this.db.db.prepare(sql).run(...values);
        const id = Number(result.lastInsertRowid);
        if (!Number.isSafeInteger(id)) throw new ValidationError('Order detail ID is outside the supported range');
        return this.storedLine(id);
      }).immediate();
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Update order detail by ID
   */
  async update(
    id: number,
    orderDetail: Partial<OrderDetailInput>,
  ): Promise<OrderDetail> {
    try {
      this.validateInput(orderDetail);
      if (orderDetail.quantity !== undefined) {
        this.validateQuantity(orderDetail.quantity);
      }
      return this.db.db.transaction(() => {
        const existing = this.storedLine(id);
        const fields = {
          orderId: orderDetail.orderId === undefined ? existing.orderId : orderDetail.orderId,
          productId: orderDetail.productId === undefined ? existing.productId : orderDetail.productId,
          quantity: orderDetail.quantity === undefined ? existing.quantity : orderDetail.quantity,
          notes: orderDetail.notes === undefined ? existing.notes : orderDetail.notes,
          unitPrice: existing.unitPrice,
        };
        if (fields.productId !== existing.productId) {
          fields.unitPrice = this.catalogPrice(fields.productId);
        }
        this.validateOrderTotal(fields, id);
        const { sql, values } = buildUpdateSQL('order_details', fields, 'order_detail_id = ?');
        this.db.db.prepare(sql).run(...values, id);
        return this.storedLine(id);
      }).immediate();
    } catch (error) {
      handleDatabaseError(error, 'OrderDetail', id);
    }
  }

  private validateInput(input: unknown): void {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ValidationError('Order detail must be an object');
    }
  }

  private validateQuantity(quantity: number): void {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new ValidationError('Quantity must be a positive integer');
    }
  }

  private storedLine(id: number): OrderDetail {
    const row = this.db.db.prepare<[number], DatabaseRow>(
      'SELECT * FROM order_details WHERE order_detail_id = ?',
    ).get(id);
    if (!row) throw new NotFoundError('OrderDetail', id);
    return objectToCamelCase<OrderDetail>(row);
  }

  private validateOrderTotal(
    line: Pick<OrderDetail, 'orderId' | 'quantity' | 'unitPrice'>,
    excludeId: number | null = null,
  ): void {
    const rows = this.db.db.prepare<
      [number, number | null, number | null],
      { quantity: number; unitPrice: number }
    >(
      `SELECT quantity, unit_price AS unitPrice FROM order_details
       WHERE order_id = ? AND (? IS NULL OR order_detail_id <> ?)`,
    ).all(line.orderId, excludeId, excludeId);
    orderTotal([...rows, line]);
  }

  private catalogPrice(productId: number): number {
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw new ValidationError('Product ID must be a positive integer');
    }
    const product = this.db.db.prepare<[number], { price: number; discount?: number }>(
      'SELECT price, discount FROM products WHERE product_id = ?',
    ).get(productId);
    if (!product) throw new NotFoundError('Product', productId);
    return discountedUnitPrice(product.price, product.discount);
  }

  /**
   * Delete order detail by ID
   */
  async delete(id: number): Promise<void> {
    try {
      const result = await this.db.run('DELETE FROM order_details WHERE order_detail_id = ?', [id]);

      if (result.changes === 0) {
        throw new NotFoundError('OrderDetail', id);
      }
    } catch (error) {
      handleDatabaseError(error, 'OrderDetail', id);
    }
  }

  /**
   * Check if order detail exists
   */
  async exists(id: number): Promise<boolean> {
    try {
      const result = await this.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM order_details WHERE order_detail_id = ?',
        [id],
      );
      return (result?.count || 0) > 0;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Find order details by order ID
   */
  async findByOrderId(orderId: number): Promise<OrderDetail[]> {
    try {
      const rows = await this.db.all<DatabaseRow>(
        'SELECT * FROM order_details WHERE order_id = ? ORDER BY order_detail_id',
        [orderId],
      );
      return mapDatabaseRows<OrderDetail>(rows);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Find order details by product ID
   */
  async findByProductId(productId: number): Promise<OrderDetail[]> {
    try {
      const rows = await this.db.all<DatabaseRow>(
        'SELECT * FROM order_details WHERE product_id = ? ORDER BY order_detail_id',
        [productId],
      );
      return mapDatabaseRows<OrderDetail>(rows);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Calculate total value for an order
   */
  async getTotalValueByOrderId(orderId: number): Promise<number> {
    try {
      return orderTotal(await this.findByOrderId(orderId));
    } catch (error) {
      handleDatabaseError(error);
    }
  }
}

// Factory function to create repository instance
export async function createOrderDetailsRepository(
  isTest: boolean = false,
): Promise<OrderDetailsRepository> {
  const db = await getDatabase(isTest);
  return new OrderDetailsRepository(db);
}

// Singleton instance for default usage
let orderDetailsRepo: OrderDetailsRepository | null = null;

export async function getOrderDetailsRepository(
  isTest: boolean = false,
): Promise<OrderDetailsRepository> {
  const isTestEnv = isTest || process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (isTestEnv) {
    return createOrderDetailsRepository(true);
  }
  if (!orderDetailsRepo) {
    orderDetailsRepo = await createOrderDetailsRepository(isTest);
  }
  return orderDetailsRepo;
}
