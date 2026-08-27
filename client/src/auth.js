import { createClient } from '@supabase/supabase-js';

const env = import.meta.env || {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const authConfigured = Boolean(url && key);
export const supabase = authConfigured ? createClient(url, key) : null;
