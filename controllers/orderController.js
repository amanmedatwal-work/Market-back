const Order = require('../models/Order');
const Project = require('../models/Project');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { getConnectionStatus } = require('../config/db');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});


// @desc    Create new order and simulate payment
// @route   POST /api/orders
// @access  Private
const createOrder = async (req, res) => {
  try {
    const { projectId, paymentMethod } = req.body;

    const project = await Project.findById(projectId);

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const order = new Order({
      buyer: req.user._id,
      project: project._id,
      paymentMethod,
      totalPrice: project.price,
      isPaid: true, // Simulated payment success
      paidAt: Date.now(),
      paymentResult: {
        id: `sim_payment_${Math.floor(Math.random() * 1000000)}`,
        status: 'succeeded',
        email_address: req.user.email
      }
    });

    const createdOrder = await order.save();

    res.status(201).json(createdOrder);
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('buyer', 'name email')
      .populate('project');

    if (order) {
      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ buyer: req.user._id }).populate('project');
    res.json(orders);
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create Razorpay order
// @route   POST /api/orders/razorpay
// @access  Private
const createRazorpayOrder = async (req, res) => {
  try {
    const { projectId } = req.body;
    const project = await Project.findById(projectId);

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const amountInPaise = Math.round(project.price * 83 * 100);

    const options = {
      amount: amountInPaise,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    
    if (!order) {
      return res.status(500).json({ message: 'Some error occurred with Razorpay' });
    }

    res.json(order);
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

// @desc    Verify Razorpay payment
// @route   POST /api/orders/verify
// @access  Private
const verifyRazorpayPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      projectId,
    } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSign) {
      const project = await Project.findById(projectId);
      
      const newOrder = new Order({
        buyer: req.user._id,
        project: project._id,
        paymentMethod: 'Razorpay',
        totalPrice: project.price,
        isPaid: true,
        paidAt: Date.now(),
        paymentResult: {
          id: razorpay_payment_id,
          status: 'succeeded',
          update_time: new Date().toISOString(),
          email_address: req.user.email
        }
      });

      const savedOrder = await newOrder.save();
      return res.status(200).json({ message: "Payment verified successfully", order: savedOrder });
    } else {
      return res.status(400).json({ message: "Invalid signature sent!" });
    }
  } catch (error) {
    if (!getConnectionStatus()) {
      return res.status(500).json({ message: 'Server error! Make sure MongoDB is running.' });
    }
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createOrder,
  getOrderById,
  getMyOrders,
  createRazorpayOrder,
  verifyRazorpayPayment
};
