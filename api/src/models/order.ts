/**
 * @swagger
 * components:
 *   schemas:
 *     Order:
 *       type: object
 *       required:
 *         - orderId
 *         - branchId
 *         - orderDate
 *         - totalAmount
 *       properties:
 *         orderId:
 *           type: integer
 *           description: The unique identifier for the order
 *         branchId:
 *           type: integer
 *           description: The ID of the branch that placed the order
 *         orderDate:
 *           type: string
 *           format: date-time
 *           description: The date and time when the order was placed
 *         status:
 *           type: string
 *           description: The current status of the order
 *           enum: [pending, processing, shipped, delivered, cancelled]
 *         totalAmount:
 *           type: number
 *           format: float
 *           readOnly: true
 *           description: Sum of rounded line amounts using stored prices, or 0 for an empty order
 */
export interface Order {
  orderId: number;
  branchId: number;
  orderDate: string;
  name: string;
  description: string;
  status: string;
  totalAmount: number;
}

export type OrderInput = Omit<Order, 'orderId' | 'totalAmount'>;
