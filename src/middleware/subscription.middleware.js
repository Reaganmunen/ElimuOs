const ApiError = require('../utils/ApiError');
const subscriptionModel = require('../models/schoolSubscription.model');

/**
 * NOT applied to any route by default. Deliberately opt-in: wiring this
 * onto every route right now would lock out every school created during
 * development/testing (including the test admin used throughout this
 * project) the moment their trial subscription doesn't exist or expires,
 * with no billing UI yet for them to fix it. Apply it explicitly once
 * you're ready to actually enforce payment, e.g.:
 *
 *   router.use(authenticate, requireLiveSubscription, restrictTo(...));
 *
 * on whichever route groups should be gated (probably everything except
 * /auth, /schools/me, and /billing itself, so a school can still see its
 * own subscription status and pay even while locked out of the rest).
 */
const requireLiveSubscription = async (req, res, next) => {
  try {
    if (!req.user?.school_id) {
      return next(new ApiError(403, 'No school context on this account'));
    }
    const subscription = await subscriptionModel.getLiveForSchool(req.user.school_id);
    if (!subscription) {
      return next(new ApiError(402, 'This school has no active subscription. Please subscribe to continue.'));
    }
    if (subscription.status === 'past_due') {
      return next(new ApiError(402, 'This school\'s subscription payment is past due. Please update billing to continue.'));
    }
    req.subscription = subscription;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireLiveSubscription };