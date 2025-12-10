// controllers/paymentController.js
const { Payment, Ride, PaymentMethod } = require('../models');

class PaymentController {
  constructor(paymentService) {
    this.paymentService = paymentService;
  }

  /**
   * Initialisation d'un paiement
   */
  async initiatePayment(req, res) {
    try {
      const { rideId, paymentMethod, provider } = req.body;
      const userId = req.user.uid;

      // Récupérer la course pour obtenir le montant
      const ride = await Ride.findByPk(rideId);
      if (!ride) {
        return res.status(404).json({
          success: false,
          error: 'Course non trouvée'
        });
      }

      const amount = ride.final_fare || ride.estimated_fare;
      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Montant de la course invalide'
        });
      }

      const paymentData = {
        rideId,
        userId,
        amount: parseFloat(amount),
        paymentMethod,
        provider,
        customerEmail: req.user.email,
        customerPhone: req.user.phone_number,
        customerName: `${req.user.first_name} ${req.user.last_name}`,
        metadata: {
          user_agent: req.get('User-Agent'),
          ip_address: req.ip
        }
      };

      const result = await this.paymentService.initiatePayment(paymentData);

      res.json({
        success: true,
        ...result
      });

    } catch (error) {
      console.error('Erreur initiation paiement:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Confirmation d'un paiement
   */
  async confirmPayment(req, res) {
    try {
      const { paymentId } = req.params;
      const confirmationData = req.body;
      const userId = req.user.uid;

      // Vérifier que l'utilisateur a le droit de confirmer ce paiement
      const payment = await Payment.findOne({
        where: { id: paymentId, user_id: userId }
      });

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: 'Paiement non trouvé'
        });
      }

      const result = await this.paymentService.confirmPayment(paymentId, confirmationData);

      res.json({
        success: true,
        ...result
      });

    } catch (error) {
      console.error('Erreur confirmation paiement:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Récupération du statut d'un paiement
   */
  async getPaymentStatus(req, res) {
    try {
      const { paymentId } = req.params;
      const userId = req.user.uid;

      const payment = await this.paymentService.getPaymentStatus(paymentId);

      // Vérifier les permissions
      if (payment.user_id !== userId && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Accès non autorisé'
        });
      }

      res.json({
        success: true,
        payment
      });

    } catch (error) {
      console.error('Erreur récupération statut paiement:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Remboursement d'un paiement
   */
  async refundPayment(req, res) {
    try {
      const { paymentId } = req.params;
      const { amount, reason } = req.body;

      // Seuls les admins peuvent effectuer des remboursements
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Autorisation insuffisante'
        });
      }

      const result = await this.paymentService.refundPayment(paymentId, {
        amount: amount ? parseFloat(amount) : null,
        reason
      });

      res.json({
        success: true,
        ...result
      });

    } catch (error) {
      console.error('Erreur remboursement:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Gestion des webhooks de paiement
   */
  async handleWebhook(req, res) {
    try {
      const { provider } = req.params;
      const payload = req.body;
      const signature = req.headers['stripe-signature'] || 
                       req.headers['verif-hash'] || 
                       req.headers['x-orange-signature'];

      await this.paymentService.handleWebhook(provider, payload, signature);

      res.json({ success: true });

    } catch (error) {
      console.error('Erreur webhook:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Gestion des méthodes de paiement
   */
  async addPaymentMethod(req, res) {
    try {
      const { type, provider, details } = req.body;
      const userId = req.user.uid;

      const paymentMethod = await this.paymentService.addPaymentMethod(userId, {
        type,
        provider,
        details
      });

      res.json({
        success: true,
        paymentMethod
      });

    } catch (error) {
      console.error('Erreur ajout méthode paiement:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async getPaymentMethods(req, res) {
    try {
      const userId = req.user.uid;
      const paymentMethods = await this.paymentService.getUserPaymentMethods(userId);

      res.json({
        success: true,
        paymentMethods
      });

    } catch (error) {
      console.error('Erreur récupération méthodes paiement:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async setDefaultPaymentMethod(req, res) {
    try {
      const { methodId } = req.params;
      const userId = req.user.uid;

      await this.paymentService.setDefaultPaymentMethod(userId, methodId);

      res.json({
        success: true,
        message: 'Méthode de paiement définie par défaut'
      });

    } catch (error) {
      console.error('Erreur définition méthode défaut:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Historique des paiements
   */
  async getPaymentHistory(req, res) {
    try {
      const userId = req.user.uid;
      const { limit = 20, offset = 0 } = req.query;

      const payments = await Payment.findAll({
        where: { user_id: userId },
        include: [
          {
            model: Ride,
            as: 'ride',
            attributes: ['id', 'pickup_address', 'destination_address', 'requested_at']
          }
        ],
        order: [['created_at', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      const total = await Payment.count({ where: { user_id: userId } });

      res.json({
        success: true,
        payments,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: total > parseInt(offset) + parseInt(limit)
        }
      });

    } catch (error) {
      console.error('Erreur historique paiements:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
      });
    }
  }
}

module.exports = PaymentController;