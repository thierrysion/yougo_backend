// services/PricingService.js
const { RideType, PricingRule } = require('../models');
const { Op } = require('sequelize');

class PricingService {
  constructor() {
    this.ruleProcessors = {
      'fixed': this.applyFixedRule.bind(this),
      'percentage': this.applyPercentageRule.bind(this),
      'per_km': this.applyPerKmRule.bind(this),
      'per_minute': this.applyPerMinuteRule.bind(this),
      'formula': this.applyFormulaRule.bind(this)
    };
  }

  async calculateAllRideTypes(pricingContext) {
    try {
      // Validation du contexte
      this.validatePricingContext(pricingContext);
      
      // Récupération de tous les types de course actifs
      const activeRideTypes = await RideType.findAll({
        where: { is_active: true },
        include: [{
          model: PricingRule,
          as: 'pricing_rules',
          where: { 
            is_active: true,
            valid_from: { [Op.lte]: new Date() },
            [Op.or]: [
              { valid_until: { [Op.gte]: new Date() } },
              { valid_until: null }
            ]
          },
          required: false
        }]
      });

      // Calcul pour chaque type de course
      const rideOptions = [];
      for (const rideType of activeRideTypes) {
        const option = await this.calculateSingleRide(rideType, pricingContext);
        rideOptions.push(option);
      }

      // Tri par prix croissant
      return rideOptions.sort((a, b) => a.estimatedFare - b.estimatedFare);
      
    } catch (error) {
      throw new Error(`Pricing calculation failed: ${error.message}`);
    }
  }

  async calculateSingleRide(rideType, context) {
    // Calcul du prix de base
    const baseFare = parseFloat(rideType.base_fare);
    const distanceFare = parseFloat(rideType.per_km_rate) * context.distanceKm;
    const timeFare = parseFloat(rideType.per_minute_rate) * context.durationMinutes;
    
    let total = baseFare + distanceFare + timeFare;
    
    // Structure de détail du calcul
    const fareBreakdown = {
      base: baseFare,
      distance: distanceFare,
      time: timeFare,
      surcharges: 0,
      bonuses: 0,
	  fees: 0,
      total: total
    };

    const appliedRules = [];
    let appliedRulesCount = 0;

    // Application des règles de tarification
    if (rideType.pricingRules && rideType.pricingRules.length > 0) {
      // Tri des règles par priorité
      const sortedRules = rideType.pricingRules.sort((a, b) => a.priority - b.priority);
      
      for (const rule of sortedRules) {
        const ruleResult = await this.applyPricingRule(rule, total, context, fareBreakdown);
        
        if (ruleResult.applied) {
          total += ruleResult.amount;
          fareBreakdown.total = total;
          appliedRulesCount++;
          
          // Mise à jour des catégories
          if (ruleResult.amount > 0) {
            fareBreakdown.surcharges += ruleResult.amount;
          } else {
            fareBreakdown.bonuses += ruleResult.amount;
          }
          
          appliedRules.push({
            ruleName: rule.name,
            amount: ruleResult.amount,
            description: rule.description
          });
        }
      }
    }

    // Application du prix minimum
    if (total < parseFloat(rideType.minimum_fare)) {
      const adjustment = parseFloat(rideType.minimum_fare) - total;
      total = parseFloat(rideType.minimum_fare);
      fareBreakdown.total = total;
      fareBreakdown.surcharges += adjustment;
      
      appliedRules.push({
        ruleName: "Minimum fare adjustment",
        amount: adjustment,
        description: `Applied minimum fare of ${rideType.minimum_fare}`
      });
    }

    return {
      rideType: {
        id: rideType.id,
        name: rideType.name,
        icon_url: rideType.icon_url,
        description: rideType.description
      },
      estimatedFare: Math.round(total),
      finalFare: Math.round(total),
      durationEstimate: context.durationMinutes,
      distanceEstimate: context.distanceKm,
      fareBreakdown: this.formatBreakdown(fareBreakdown),
      appliedRules,
      appliedRulesCount,
	  currency: 'XAF',
    };
  }

  async applyPricingRule(rule, currentTotal, context, breakdown) {
    try {
      // Vérification des conditions
      const conditionsMet = await this.checkRuleConditions(rule, context);
      if (!conditionsMet) {
        return { applied: false, amount: 0 };
      }

      // Application du calcul selon le type
      const processor = this.ruleProcessors[rule.calculation_type];
      if (!processor) {
        console.warn(`Unknown calculation type: ${rule.calculation_type}`);
        return { applied: false, amount: 0 };
      }

      const amount = await processor(rule, currentTotal, context, breakdown);
      
      // Application des limites
      const finalAmount = this.applyAmountLimits(amount, rule.max_amount);
      
      return { applied: true, amount: finalAmount };
      
    } catch (error) {
      console.error(`Error applying rule ${rule.name}:`, error);
      return { applied: false, amount: 0 };
    }
  }

    // Application des règles de type fixed
    applyFixedRule(rule) {
    const params = rule.calculation_parameters;
    return parseFloat(params.amount) || 0;
    }

    // Application des règles de type percentage
    applyPercentageRule(rule, currentTotal) {
    const params = rule.calculation_parameters;
    const rate = parseFloat(params.rate) || 0;
    const base = params.base === 'total' ? currentTotal : 
                params.base === 'base' ? breakdown.base : 0;
    
    return (base * rate) / 100;
    }

    // Application des règles de type per_km
    applyPerKmRule(rule, currentTotal, context) {
    const params = rule.calculation_parameters;
    const rate = parseFloat(params.rate) || 0;
    const minDistance = parseFloat(params.min_distance) || 0;
    
    if (context.distanceKm >= minDistance) {
        return rate * context.distanceKm;
    }
    return 0;
    }

    // Application des règles de type per_minute
    applyPerMinuteRule(rule, currentTotal, context) {
        const params = rule.calculation_parameters;
        const rate = parseFloat(params.rate) || 0;
        return rate * context.durationMinutes;
    }

    // Application des règles de type formula
    applyFormulaRule(rule, currentTotal, context, breakdown) {
        const params = rule.calculation_parameters;
        const expression = params.expression;
        
        // Variables disponibles pour les formules
        const vars = {
            base_fare: breakdown.base,
            distance: context.distanceKm,
            time: context.durationMinutes,
            current_total: currentTotal,
            demand: context.demandMultiplier || 1,
            weather: context.weatherCondition || 'normal'
        };
        
        try {
            // Évaluation sécurisée de la formule
            const result = this.evaluateFormula(expression, vars);
            return parseFloat(result) || 0;
        } catch (error) {
            throw new Error(`Formula evaluation failed: ${error.message}`);
        }
    }

    async checkRuleConditions(rule, context) {
        const { condition_type, condition_parameters } = rule;
        const params = condition_parameters;
        
        switch (condition_type) {
            case 'time':
            return this.checkTimeCondition(params, context.timestamp);
            
            case 'day':
            return this.checkDayCondition(params, context.timestamp);
            
            case 'zone':
            return this.checkZoneCondition(params, context.pickupZone, context.destinationZone);
            
            case 'demand':
            return this.checkDemandCondition(params, context.demandMultiplier);
            
            case 'weather':
            return this.checkWeatherCondition(params, context.weatherCondition);
            
            case 'distance':
            return this.checkDistanceCondition(params, context.distanceKm);
            
            default:
            console.warn(`Unknown condition type: ${condition_type}`);
            return false;
        }
    }

    checkTimeCondition(params, timestamp) {
        const now = new Date(timestamp);
        const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"
        
        if (params.type === 'range') {
            return currentTime >= params.start && currentTime <= params.end;
        }
        return false;
    }

    checkDayCondition(params, timestamp) {
        const date = new Date(timestamp);
        const dayOfWeek = date.getDay(); // 0=dimanche, 1=lundi, etc.
        
        if (params.type === 'specific') {
            return params.days.includes(dayOfWeek);
        }
        return false;
    }

    checkZoneCondition(params, pickupZone, destinationZone) {
        if (params.type === 'polygon') {
            // Implémentation simplifiée - à compléter avec un service de géolocalisation
            return pickupZone === params.zone_name || destinationZone === params.zone_name;
        }
        return false;
    }

    checkDemandCondition(params, demandMultiplier) {
        if (params.type === 'threshold') {
            const value = parseFloat(params.value);
            switch (params.operator) {
            case '>': return demandMultiplier > value;
            case '>=': return demandMultiplier >= value;
            case '<': return demandMultiplier < value;
            case '<=': return demandMultiplier <= value;
            case '==': return demandMultiplier === value;
            default: return false;
            }
        }
        return false;
    }

    // Suite de PricingService.js

    validatePricingContext(context) {
        const required = ['distanceKm', 'durationMinutes', 'pickupLocation', 'destinationLocation'];
        const missing = required.filter(field => !context[field]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
        
        if (context.distanceKm <= 0) {
            throw new Error('Distance must be greater than 0');
        }
        
        if (context.durationMinutes <= 0) {
            throw new Error('Duration must be greater than 0');
        }
    }

    applyAmountLimits(amount, maxAmount) {
        if (maxAmount !== null && maxAmount !== undefined) {
            const max = parseFloat(maxAmount);
            if (amount > 0) {
            return Math.min(amount, max);
            } else {
            return Math.max(amount, -max);
            }
        }
        return amount;
    }

    formatBreakdown(breakdown) {
        return Object.keys(breakdown).reduce((acc, key) => {
            acc[key] = Math.round(breakdown[key]);
            return acc;
        }, {});
    }

    evaluateFormula(expression, variables) {
        // Implémentation sécurisée d'évaluation de formule
        // Note: En production, utiliser une librairie comme expr-eval pour la sécurité
        const safeExpression = expression
            .replace(/base_fare/g, variables.base_fare)
            .replace(/distance/g, variables.distance)
            .replace(/time/g, variables.time)
            .replace(/current_total/g, variables.current_total)
            .replace(/demand/g, variables.demand);
        
        try {
            return eval(safeExpression);
        } catch (error) {
            throw new Error(`Formula evaluation error: ${error.message}`);
        }
    }


}

module.exports = PricingService;