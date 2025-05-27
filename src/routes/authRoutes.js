// src/routes/authRoutes.js
import express from 'express'; // Use ES6 import syntax for consistency
import { supabase, supabaseAdmin } from '../config/supabaseClient.js'; // Import Supabase clientsim
import { protectRoute } from '../middleware/authMiddleware.js'; // Import authentication middleware

const router = express.Router();

// 1. User Sign-Up
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      console.error('Supabase signup error:', error.message);
      return res.status(400).json({ error: error.message });
    }

    const { user } = data;
    if (user) {
      // Create a corresponding record in your custom "User" table
      const { data: newUserProfile, error: profileError } = await supabaseAdmin
        .from('User')
        .insert({
          id: user.id, // Link to Supabase Auth user ID (UUID)
          email: user.email,
          created_at: new Date().toISOString()
        })
        .select();

      if (profileError) {
        console.error('Error creating user profile in "User" table:', profileError.message);
        return res.status(500).json({ error: 'User signed up, but profile creation failed.' });
      }

      res.status(201).json({
        message: 'User signed up successfully. Check email for confirmation if enabled.',
        user: { id: user.id, email: user.email },
        session: data.session,
        profile: newUserProfile[0]
      });
    } else {
        res.status(200).json({ message: 'User signed up successfully. Please check your email for verification.' });
    }

  } catch (err) {
    console.error('Unexpected error during signup:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. User Sign-In
router.post('/signin', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      console.error('Supabase signin error:', error.message);
      return res.status(401).json({ error: error.message });
    }

    if (data.user) {
      // Optionally update last_login in your custom "User" table
      const { error: updateError } = await supabaseAdmin
        .from('User')
        .update({ last_login: new Date().toISOString() })
        .eq('id', data.user.id);

      if (updateError) {
        console.error('Error updating last_login:', updateError.message);
      }
    }

    res.status(200).json({
      message: 'User signed in successfully.',
      session: data.session,
      user: { id: data.user.id, email: data.user.email }
    });

  } catch (err) {
    console.error('Unexpected error during signin:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. User Sign-Out
router.post('/signout', async (req, res) => {
  // Sign out the currently authenticated user
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Supabase signout error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ message: 'User signed out successfully.' });
  } catch (err) {
    console.error('Unexpected error during signout:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 4. Get Current User (Protected Route)
router.get('/me', protectRoute, async (req, res) => {
  try {
    // req.user contains the authenticated user object from Supabase Auth (added by protectRoute middleware)
    const { data: userProfile, error } = await supabase
      .from('User')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) {
      console.error('Error fetching user profile:', error.message);
      // If user profile not found, maybe they didn't complete signup process or RLS issue
      return res.status(404).json({ error: 'User profile not found.' });
    }

    res.status(200).json({
      auth_user: req.user, // Supabase Auth user data (UUID, email, etc.)
      profile: userProfile // Your custom user profile data
    });
  } catch (err) {
    console.error('Unexpected error fetching user profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; // Export the router