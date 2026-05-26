const express = require('express');
const router = express.Router();
const {
  createOrder,
  getOrderById,
  getMyOrders,
  createRazorpayOrder,
  verifyRazorpayPayment,
} = require('../controllers/orderController');
const { protect } = require('../middleware/authMiddleware');

// Express 5 note: Using explicit HTTP methods (.post, .get) instead of
// router.route().method() to avoid Express 5 circular dependency issues
router.post('/', protect, createOrder);
router.post('/razorpay', protect, createRazorpayOrder);
router.post('/verify', protect, verifyRazorpayPayment);
router.get('/myorders', protect, getMyOrders);
router.get('/:id', protect, getOrderById);

module.exports = router;
