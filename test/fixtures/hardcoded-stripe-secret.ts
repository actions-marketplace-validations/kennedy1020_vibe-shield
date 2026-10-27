// @ts-nocheck
import Stripe from 'stripe';

// Intentional vulnerability: Live Stripe secret key literal hardcoded in source
const LIVE_STRIPE_KEY = 'sk_live_51M3AbcFakeLiveKeyForTesting99999999999';

export const stripeClient = new Stripe(LIVE_STRIPE_KEY, {
  apiVersion: '2023-10-16',
});