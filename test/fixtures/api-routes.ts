
// @ts-nocheck
import { prisma } from '@/lib/db';
import Stripe from 'stripe';
// ... rest of file 
// 1. Client-Side Secret Bleed
export const LEAKED_KEY = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;

// 2. Insecure Stripe Webhook (Parsed JSON without raw body HMAC check)
export async function POST(req: Request) {
  const event = await req.json();
  if (event.type === 'checkout.session.completed') {
    // grant tier
  }
  return Response.json({ received: true });
}

// 3. Unscoped Prisma Mutation (IDOR / BOLA)
export async function deleteDocument(docId: string) {
  return await prisma.document.delete({
    where: { id: docId }
  });
}

// 4. Exposed Unauthenticated Server Action
export async function updateUserSettings(userId: string, data: any) {
  'use server';
  return await prisma.user.update({
    where: { id: userId },
    data
  });
}