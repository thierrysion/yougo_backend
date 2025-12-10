// services/PaymentService.js
const { Payment, Ride, User, PaymentMethod } = require('../models');
const axios = require('axios');

class PaymentService {
  constructor() {
    this.providers = {
      stripe: this.stripeProvider.bind(this),
      flutterwave: this.flutterwaveProvider.bind(this),
      orange_money: this.orangeMoneyProvider.bind(this),
      mtn_money: this.mtnMoneyProvider.bind(this),
      cash: this.cashProvider.bind(this)
    };
  }

  /**
   * Initialisation d'un paiement
   */
  async initiatePayment(paymentData) {
    try {
      const { rideId, userId, amount, paymentMethod, provider } = paymentData;

      console.log(`💳 Initialisation paiement pour la course ${rideId}`);

      // Validation des données
      await this.validatePaymentData(paymentData);

      // Créer l'enregistrement de paiement
      const payment = await Payment.create({
        ride_id: rideId,
        user_id: userId,
        amount: amount,
        payment_method: paymentMethod,
        provider: provider,
        payment_status: 'pending',
        metadata: {
          initiated_at: new Date().toISOString(),
          ...paymentData.metadata
        }
      });

      // Traiter selon le provider
      const providerResult = await this.processWithProvider(payment, paymentData);

      // Mettre à jour le paiement avec les infos du provider
      await Payment.update(
        {
          provider_payment_id: providerResult.paymentId,
          provider_transaction_id: providerResult.transactionId,
          payment_status: providerResult.status,
          metadata: {
            ...payment.metadata,
            provider_response: providerResult
          }
        },
        { where: { id: payment.id } }
      );

      return {
        success: true,
        paymentId: payment.id,
        providerResult,
        nextAction: providerResult.nextAction
      };

    } catch (error) {
      console.error('Erreur initiation paiement:', error);
      
      // Enregistrer l'échec
      if (paymentData.rideId) {
        await Payment.create({
          ride_id: paymentData.rideId,
          user_id: paymentData.userId,
          amount: paymentData.amount,
          payment_method: paymentData.paymentMethod,
          provider: paymentData.provider,
          payment_status: 'failed',
          failure_reason: error.message,
          metadata: {
            error: error.message,
            stack: error.stack
          }
        });
      }

      throw error;
    }
  }

  /**
   * Validation des données de paiement
   */
  async validatePaymentData(paymentData) {
    const { rideId, userId, amount, paymentMethod, provider } = paymentData;

    if (!rideId || !userId || !amount || !paymentMethod || !provider) {
      throw new Error('Données de paiement incomplètes');
    }

    if (amount <= 0) {
      throw new Error('Montant invalide');
    }

    // Vérifier que la course existe
    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      throw new Error('Course non trouvée');
    }

    // Vérifier que l'utilisateur existe
    const user = await User.findByPk(userId);
    if (!user) {
      throw new Error('Utilisateur non trouvé');
    }

    // Vérifier que le provider est supporté
    if (!this.providers[provider]) {
      throw new Error(`Provider de paiement non supporté: ${provider}`);
    }

    return true;
  }

  /**
   * Traitement avec le provider sélectionné
   */
  async processWithProvider(payment, paymentData) {
    const provider = this.providers[paymentData.provider];
    if (!provider) {
      throw new Error(`Provider non implémenté: ${paymentData.provider}`);
    }

    return await provider(payment, paymentData);
  }

  /**
   * Provider Stripe (cartes de crédit)
   */
  async stripeProvider(payment, paymentData) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

      // Créer un PaymentIntent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(payment.amount * 100), // Convertir en centimes
        currency: payment.currency.toLowerCase(),
        payment_method_types: ['card'],
        metadata: {
          ride_id: payment.ride_id,
          user_id: payment.user_id,
          payment_id: payment.id
        }
      });

      return {
        paymentId: paymentIntent.id,
        transactionId: paymentIntent.id,
        status: 'processing',
        clientSecret: paymentIntent.client_secret,
        nextAction: {
          type: 'confirm_payment',
          clientSecret: paymentIntent.client_secret
        }
      };

    } catch (error) {
      console.error('Erreur Stripe:', error);
      throw new Error(`Erreur Stripe: ${error.message}`);
    }
  }

  /**
   * Provider Flutterwave (cartes et mobile money)
   */
  async flutterwaveProvider(payment, paymentData) {
    try {
      const response = await axios.post(
        'https://api.flutterwave.com/v3/payments',
        {
          tx_ref: `ride_${payment.ride_id}_${Date.now()}`,
          amount: payment.amount,
          currency: payment.currency,
          payment_options: paymentData.paymentMethod === 'card' ? 'card' : 'mobilemoney',
          redirect_url: `${process.env.FRONTEND_URL}/payment/callback`,
          customer: {
            email: paymentData.customerEmail,
            phonenumber: paymentData.customerPhone,
            name: paymentData.customerName
          },
          customizations: {
            title: 'Paiement Course',
            description: `Course ${payment.ride_id}`,
            logo: process.env.APP_LOGO_URL
          },
          meta: {
            ride_id: payment.ride_id,
            user_id: payment.user_id
          }
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
          }
        }
      );

      return {
        paymentId: response.data.data.id,
        transactionId: response.data.data.tx_ref,
        status: 'pending',
        authorizationUrl: response.data.data.link,
        nextAction: {
          type: 'redirect',
          url: response.data.data.link
        }
      };

    } catch (error) {
      console.error('Erreur Flutterwave:', error);
      throw new Error(`Erreur Flutterwave: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Provider Orange Money
   */
  async orangeMoneyProvider(payment, paymentData) {
    try {
      // Implémentation Orange Money
      const response = await axios.post(
        'https://api.orange.com/orange-money-webpay/cm/v1/webpayment',
        {
          merchant_key: process.env.ORANGE_MONEY_MERCHANT_KEY,
          currency: payment.currency,
          order_id: `ride_${payment.ride_id}_${Date.now()}`,
          amount: payment.amount,
          return_url: `${process.env.FRONTEND_URL}/payment/callback`,
          cancel_url: `${process.env.FRONTEND_URL}/payment/cancel`,
          notification_url: `${process.env.BACKEND_URL}/api/payments/webhook/orange`,
          lang: 'fr'
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.ORANGE_MONEY_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        paymentId: response.data.payment_url,
        transactionId: response.data.notif_token,
        status: 'pending',
        authorizationUrl: response.data.payment_url,
        nextAction: {
          type: 'redirect',
          url: response.data.payment_url
        }
      };

    } catch (error) {
      console.error('Erreur Orange Money:', error);
      throw new Error(`Erreur Orange Money: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Provider MTN Money
   */
  async mtnMoneyProvider(payment, paymentData) {
    try {
      const response = await axios.post(
        'https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay',
        {
          amount: payment.amount,
          currency: payment.currency,
          externalId: `ride_${payment.ride_id}`,
          payer: {
            partyIdType: 'MSISDN',
            partyId: paymentData.customerPhone
          },
          payerMessage: `Paiement course ${payment.ride_id}`,
          payeeNote: `Course ${payment.ride_id}`
        },
        {
          headers: {
            'X-Reference-Id': require('uuid').v4(),
            'X-Target-Environment': process.env.MTN_ENVIRONMENT || 'sandbox',
            'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY,
            Authorization: `Bearer ${await this.getMtnAccessToken()}`
          }
        }
      );

      return {
        paymentId: response.headers['x-reference-id'],
        transactionId: response.headers['x-reference-id'],
        status: 'pending',
        nextAction: {
          type: 'wait_approval',
          referenceId: response.headers['x-reference-id']
        }
      };

    } catch (error) {
      console.error('Erreur MTN Money:', error);
      throw new Error(`Erreur MTN Money: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Provider Cash (paiement physique)
   */
  async cashProvider(payment, paymentData) {
    // Pour le paiement cash, on marque directement comme complété
    return {
      paymentId: `cash_${payment.id}`,
      transactionId: `cash_${Date.now()}`,
      status: 'completed',
      nextAction: {
        type: 'none'
      }
    };
  }

  /**
   * Confirmation d'un paiement
   */
  async confirmPayment(paymentId, confirmationData) {
    try {
      const payment = await Payment.findByPk(paymentId);
      if (!payment) {
        throw new Error('Paiement non trouvé');
      }

      let result;

      // Confirmation selon le provider
      switch (payment.provider) {
        case 'stripe':
          result = await this.confirmStripePayment(payment, confirmationData);
          break;
        case 'flutterwave':
          result = await this.confirmFlutterwavePayment(payment, confirmationData);
          break;
        case 'orange_money':
          result = await this.confirmOrangeMoneyPayment(payment, confirmationData);
          break;
        case 'mtn_money':
          result = await this.confirmMtnMoneyPayment(payment, confirmationData);
          break;
        case 'cash':
          result = { status: 'completed' };
          break;
        default:
          throw new Error(`Provider non supporté: ${payment.provider}`);
      }

      // Mettre à jour le statut du paiement
      await Payment.update(
        {
          payment_status: result.status,
          processed_at: result.status === 'completed' ? new Date() : null,
          metadata: {
            ...payment.metadata,
            confirmation: confirmationData,
            provider_confirmation: result
          }
        },
        { where: { id: paymentId } }
      );

      // Mettre à jour le statut de la course si paiement réussi
      if (result.status === 'completed') {
        await this.updateRidePaymentStatus(payment.ride_id, 'paid');
        
        // Notifier le chauffeur et le client
        await this.notifyPaymentSuccess(payment);
      }

      return {
        success: true,
        paymentId: payment.id,
        status: result.status,
        rideId: payment.ride_id
      };

    } catch (error) {
      console.error('Erreur confirmation paiement:', error);
      
      // Marquer comme échec
      await Payment.update(
        {
          payment_status: 'failed',
          failure_reason: error.message
        },
        { where: { id: paymentId } }
      );

      throw error;
    }
  }

  /**
   * Mise à jour du statut de paiement d'une course
   */
  async updateRidePaymentStatus(rideId, paymentStatus) {
    await Ride.update(
      { payment_status: paymentStatus },
      { where: { id: rideId } }
    );
  }

  /**
   * Notification de succès de paiement
   */
  async notifyPaymentSuccess(payment) {
    try {
      const NotificationService = require('./NotificationService');
      const notificationService = new NotificationService(this.io);

      // Notifier le client
      await notificationService.sendNotification(
        payment.user_id,
        'payment_success',
        {
          rideId: payment.ride_id,
          amount: payment.amount,
          paymentMethod: payment.payment_method
        }
      );

      // Récupérer la course pour notifier le chauffeur
      const ride = await Ride.findByPk(payment.ride_id);
      if (ride && ride.driver_id) {
        await notificationService.sendNotification(
          ride.driver_id,
          'payment_success',
          {
            rideId: payment.ride_id,
            amount: payment.amount,
            earnings: this.calculateDriverEarnings(payment.amount)
          }
        );
      }

    } catch (error) {
      console.error('Erreur notification paiement:', error);
    }
  }

  /**
   * Calcul des revenus du chauffeur
   */
  calculateDriverEarnings(amount) {
    const commissionRate = 0.2; // 20% de commission
    return amount * (1 - commissionRate);
  }

  /**
   * Remboursement d'un paiement
   */
  async refundPayment(paymentId, refundData = {}) {
    try {
      const { amount, reason } = refundData;
      
      const payment = await Payment.findByPk(paymentId);
      if (!payment) {
        throw new Error('Paiement non trouvé');
      }

      if (payment.payment_status !== 'completed') {
        throw new Error('Seuls les paiements complétés peuvent être remboursés');
      }

      const refundAmount = amount || payment.amount;
      if (refundAmount > payment.amount - payment.refunded_amount) {
        throw new Error('Montant de remboursement trop élevé');
      }

      let refundResult;

      // Remboursement selon le provider
      switch (payment.provider) {
        case 'stripe':
          refundResult = await this.refundStripePayment(payment, refundAmount);
          break;
        case 'flutterwave':
          refundResult = await this.refundFlutterwavePayment(payment, refundAmount);
          break;
        default:
          throw new Error(`Remboursement non supporté pour ${payment.provider}`);
      }

      // Mettre à jour le paiement
      const newRefundedAmount = parseFloat(payment.refunded_amount) + parseFloat(refundAmount);
      const newStatus = newRefundedAmount === payment.amount ? 'refunded' : 'partially_refunded';

      await Payment.update(
        {
          payment_status: newStatus,
          refunded_amount: newRefundedAmount,
          refunded_at: new Date(),
          metadata: {
            ...payment.metadata,
            refund: refundResult,
            refund_reason: reason
          }
        },
        { where: { id: paymentId } }
      );

      return {
        success: true,
        paymentId: payment.id,
        refundAmount,
        status: newStatus
      };

    } catch (error) {
      console.error('Erreur remboursement:', error);
      throw error;
    }
  }

  /**
   * Remboursement Stripe
   */
  async refundStripePayment(payment, amount) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const refund = await stripe.refunds.create({
      payment_intent: payment.provider_payment_id,
      amount: Math.round(amount * 100)
    });

    return {
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount / 100
    };
  }

  /**
   * Récupération du statut d'un paiement
   */
  async getPaymentStatus(paymentId) {
    const payment = await Payment.findByPk(paymentId, {
      include: [
        {
          model: Ride,
          as: 'ride',
          attributes: ['id', 'status', 'pickup_address', 'destination_address']
        }
      ]
    });

    if (!payment) {
      throw new Error('Paiement non trouvé');
    }

    return payment;
  }

  /**
   * Gestion des webhooks de paiement
   */
  async handleWebhook(provider, payload, signature) {
    try {
      switch (provider) {
        case 'stripe':
          return await this.handleStripeWebhook(payload, signature);
        case 'flutterwave':
          return await this.handleFlutterwaveWebhook(payload);
        case 'orange_money':
          return await this.handleOrangeMoneyWebhook(payload);
        default:
          throw new Error(`Webhook non supporté pour ${provider}`);
      }
    } catch (error) {
      console.error(`Erreur webhook ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Webhook Stripe
   */
  async handleStripeWebhook(payload, signature) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handleStripePaymentSuccess(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.handleStripePaymentFailure(event.data.object);
        break;
    }

    return { success: true };
  }

  async handleStripePaymentSuccess(paymentIntent) {
    const payment = await Payment.findOne({
      where: { provider_payment_id: paymentIntent.id }
    });

    if (payment) {
      await this.confirmPayment(payment.id, { via: 'webhook' });
    }
  }

  async handleStripePaymentFailure(paymentIntent) {
    const payment = await Payment.findOne({
      where: { provider_payment_id: paymentIntent.id }
    });

    if (payment) {
      await Payment.update(
        {
          payment_status: 'failed',
          failure_reason: paymentIntent.last_payment_error?.message || 'Échec de paiement'
        },
        { where: { id: payment.id } }
      );
    }
  }

  /**
   * Méthodes d'assistance
   */
  async getMtnAccessToken() {
    // Implémentation pour obtenir le token d'accès MTN
    const response = await axios.post(
      'https://sandbox.momodeveloper.mtn.com/collection/token/',
      {},
      {
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY,
          Authorization: `Basic ${Buffer.from(
            `${process.env.MTN_API_USER}:${process.env.MTN_API_KEY}`
          ).toString('base64')}`
        }
      }
    );

    return response.data.access_token;
  }

  /**
   * Gestion des méthodes de paiement utilisateur
   */
  async addPaymentMethod(userId, methodData) {
    try {
      const { type, provider, details } = methodData;

      // Vérifier si c'est la première méthode => la définir comme défaut
      const existingMethods = await PaymentMethod.count({
        where: { user_id: userId }
      });

      const isDefault = existingMethods === 0;

      const paymentMethod = await PaymentMethod.create({
        user_id: userId,
        type,
        provider,
        details,
        is_default: isDefault
      });

      return paymentMethod;

    } catch (error) {
      console.error('Erreur ajout méthode paiement:', error);
      throw error;
    }
  }

  async getUserPaymentMethods(userId) {
    return await PaymentMethod.findAll({
      where: { user_id: userId },
      order: [['is_default', 'DESC'], ['created_at', 'DESC']]
    });
  }

  async setDefaultPaymentMethod(userId, methodId) {
    // Réinitialiser toutes les méthodes
    await PaymentMethod.update(
      { is_default: false },
      { where: { user_id: userId } }
    );

    // Définir la nouvelle méthode par défaut
    await PaymentMethod.update(
      { is_default: true },
      { 
        where: { 
          id: methodId,
          user_id: userId 
        } 
      }
    );

    return true;
  }
}

module.exports = PaymentService;