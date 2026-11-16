/**
 * Repository for order details data access
 */

import { getDatabase, DatabaseConnection } from '../db/sqlite';
import { OrderDetail, OrderDetailInput } from '../models/orderDetail';
import { handleDatabaseError, NotFoundError, ValidationError } from '../utils/errors';
import { buildInsertSQL, buildUpdateSQL, objectToCamelCase, mapDatabaseRows, DatabaseRow } from '../utils/sql';
import { discountedUnitPrice, orderTotal } from '../utils/pricing';
import { ProductsRepository } from './productsRepo';

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
      const unitPrice = await this.catalogPrice(orderDetail.productId);
      const { sql, values } = buildInsertSQL('order_details', {
        orderId: orderDetail.orderId,
        productId: orderDetail.productId,
        quantity: orderDetail.quantity,
        unitPrice,
        notes: orderDetail.notes ?? '',
      });
      const result = await this.db.run(sql, values);

      const createdOrderDetail = await this.findById(result.lastID || 0);
      if (!createdOrderDetail) {
        throw new Error('Failed to retrieve created order detail');
      }

      return createdOrderDetail;
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
      const existing = await this.findById(id);
      if (!existing) {
        throw new NotFoundError('OrderDetail', id);
      }
      if (orderDetail.quantity !== undefined) {
        this.validateQuantity(orderDetail.quantity);
      }
      const fields: Record<string, unknown> = {};
      for (const key of ['orderId', 'quantity', 'notes'] as const) {
        if (orderDetail[key] !== undefined) fields[key] = orderDetail[key];
      }
      if (orderDetail.productId !== undefined && orderDetail.productId !== existing.productId) {
        fields.unitPrice = await this.catalogPrice(orderDetail.productId);
        fields.productId = orderDetail.productId;
      }
      if (Object.keys(fields).length === 0) return existing;
      const { sql, values } = buildUpdateSQL('order_details', fields, 'order_detail_id = ?');
      const result = await this.db.run(sql, [...values, id]);

      if (result.changes === 0) {
        throw new NotFoundError('OrderDetail', id);
      }

      const updatedOrderDetail = await this.findById(id);
      if (!updatedOrderDetail) {
        throw new Error('Failed to retrieve updated order detail');
      }

      return updatedOrderDetail;
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

  private async catalogPrice(productId: number): Promise<number> {
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw new ValidationError('Product ID must be a positive integer');
    }
    const product = await new ProductsRepository(this.db).findById(productId);
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
