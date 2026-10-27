// @ts-nocheck
'use client';

import { createClient } from '@supabase/supabase-js';

// Intentional vulnerability: Supabase service role key exposed inside a client component
const supabaseUrl = 'https://example-project.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

export default function UserManagementPage() {
  return null;
}