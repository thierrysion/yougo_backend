// routes/payments.js
const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDriver, requireAdmin, optionalAuth } = require('../middleware/auth');
const { check } = require('express-validator');
const PaymentController = require('../controllers/paymentController.js');

let paymentController;

module.exports = (paymentService) => {
  paymentController = new PaymentController(paymentService);

  // POST /api/payments/initiate - Initialiser un paiement
  router.post('/initiate', [
    authenticate,
    check('rideId').isUUID(),
    check('paymentMethod').isIn(['card', 'mobile_money', 'wallet', 'cash']),
    check('provider').isIn(['stripe', 'flutterwave', 'orange_money', 'mtn_money', 'cash'])
  ], paymentController.initiatePayment.bind(paymentController));

  // POST /api/payments/:paymentId/confirm - Confirmer un paiement
  router.post('/:paymentId/confirm', authenticate, 
    paymentController.confirmPayment.bind(paymentController));

  // GET /api/payments/:paymentId/status - Statut d'un paiement
  router.get('/:paymentId/status', authenticate, 
    paymentController.getPaymentStatus.bind(paymentController));

  // POST /api/payments/:paymentId/refund - Remboursement (admin)
  router.post('/:paymentId/refund', [
    authenticate,
    check('amount').optional().isFloat({ min: 0 }),
    check('reason').optional().isLength({ max: 500 })
  ], paymentController.refundPayment.bind(paymentController));

  // POST /api/payments/webhook/:provider - Webhooks
  router.post('/webhook/:provider', 
    paymentController.handleWebhook.bind(paymentController));

  // POST /api/payments/methods - Ajouter méthode paiement
  router.post('/methods', [
    authenticate,
    check('type').isIn(['card', 'mobile_money', 'wallet']),
    check('provider').isIn(['stripe', 'orange_money', 'mtn_money', 'wave']),
    check('details').isObject()
  ], paymentController.addPaymentMethod.bind(paymentController));

  // GET /api/payments/methods - Mes méthodes paiement
  router.get('/methods', authenticate, 
    paymentController.getPaymentMethods.bind(paymentController));

  // PUT /api/payments/methods/:methodId/default - Définir méthode par défaut
  router.put('/methods/:methodId/default', authenticate, 
    paymentController.setDefaultPaymentMethod.bind(paymentController));

  // GET /api/payments/history - Historique des paiements
  router.get('/history', authenticate, 
    paymentController.getPaymentHistory.bind(paymentController));

  return router;
};