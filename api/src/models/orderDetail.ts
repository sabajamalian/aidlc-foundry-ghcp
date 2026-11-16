/**
 * @swagger
 * components:
 *   schemas:
 *     OrderDetail:
 *       type: object
 *       required:
 *         - orderDetailId
 *         - orderId
 *         - productId
 *         - quantity
 *         - unitPrice
 *       properties:
 *         orderDetailId:
 *           type: integer
 *           description: The unique identifier for the order detail
 *         orderId:
 *           type: integer
 *           description: The ID of the parent order
 *         productId:
 *           type: integer
 *           description: The ID of the product ordered
 *         quantity:
 *           type: integer
 *           minimum: 1
 *           description: The quantity of products ordered
 *         unitPrice:
 *           type: number
 *           format: float
 *           readOnly: true
 *           description: Server-calculated discounted catalog price, snapshotted when the product is selected
 *         notes:
 *           type: string
 *           description: Additional notes for the order detail
 */
export interface OrderDetail {
  orderDetailId: number;
  orderId: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  notes: string;
}

/**
 * @swagger
 * components:
 *   schemas:
 *     OrderDetailInput:
 *       type: object
 *       required: [orderId, productId, quantity]
 *       properties:
 *         orderId:
 *           type: integer
 *         productId:
 *           type: integer
 *           minimum: 1
 *         quantity:
 *           type: integer
 *           minimum: 1
 *         notes:
 *           type: string
 *         unitPrice:
 *           type: number
 *           deprecated: true
 *           description: Accepted for legacy clients but ignored on create and update
 *     OrderDetailUpdate:
 *       type: object
 *       description: Partial update; only changing productId recalculates the stored price
 *       properties:
 *         orderId:
 *           type: integer
 *         productId:
 *           type: integer
 *           minimum: 1
 *         quantity:
 *           type: integer
 *           minimum: 1
 *         notes:
 *           type: string
 *         unitPrice:
 *           type: number
 *           deprecated: true
 *           description: Ignored; cannot override the stored server price
 */
export type OrderDetailInput =
  Omit<OrderDetail, 'orderDetailId' | 'unitPrice' | 'notes'> &
  Partial<Pick<OrderDetail, 'unitPrice' | 'notes'>>;
