// src/config/supabaseClient.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
  console.error("Supabase URL or Keys are missing. Please check your .env file.");
  process.exit(1);
}

// Client for regular user operations (signup, signin, etc.)
// Uses the anon key as it operates on behalf of the user, respecting RLS.
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Client for privileged backend operations (e.g., updating user profiles after signup)
// Uses the service_role key to bypass RLS.
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

module.exports = { supabase, supabaseAdmin };
