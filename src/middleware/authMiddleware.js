// src/middleware/authMiddleware.js
import { supabase } from '../config/supabaseClient.js';

async function protectRoute(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No authorization token provided.' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
      console.error('Supabase get user error:', error.message);
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    if (!user) {
      return res.status(401).json({ error: 'User not found for this token.' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Unexpected error in protectRoute middleware:', err);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
}

export { protectRoute };