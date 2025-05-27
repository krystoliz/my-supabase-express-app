// src/routes/flashcardRoutes.js
import express from 'express'; // Use ES6 import syntax for consistency
const router = express.Router();
import { supabase } from '../config/supabaseClient.js';
import { protectRoute } from '../middleware/authMiddleware.js';


// Route to get all flashcard sets for the authenticated user
router.get('/', protectRoute, async (req, res) => {
  try {
    // req.user.id is available from the protectRoute middleware
    const userId = req.user.id; // Store user ID for logging
    // req.user.id is available from the protectRoute middleware
    // --- ADD LOGGING HERE ---
    console.log('Fetching flashcard sets for user ID:', userId);
    // --- END LOGGING ---
    const { data, error } = await supabase
      .from('flashcardset')
      .select('*')
      .eq('owner_id', userId); // Filter by the authenticated user's ID

    if (error) {
      console.error('Error fetching flashcard sets:', error.message);
      // --- ADD LOGGING HERE ---
      console.error('Supabase query error details:', error);
      // --- END LOGGING ---
      return res.status(500).json({ error: error.message });
    }

    // --- ADD LOGGING HERE ---
    console.log('Successfully fetched flashcard sets. Count:', data.length);
    console.log('Fetched data:', data); // Log the actual data
    // --- END LOGGING ---

    res.status(200).json(data);
  } catch (err) {
    console.error('Unexpected error in GET /api/flashcards', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to create a new flashcard set
router.post('/', protectRoute, async (req, res) => {
  const { title, description, visibility } = req.body;

  if (!title) {
    return res.status(400).json({ error: 'Title is required for a flashcard set.' });
  }

  // --- Start of added debugging ---
  console.log('Attempting to create FlashcardSet:');
  console.log('  req.user.id:', req.user ? req.user.id : 'User ID not available'); // Check if user ID is present
  console.log('  Title:', title);
  console.log('  Description:', description);
  console.log('  Visibility:', visibility);
  // --- End of added debugging ---

  try {
    const { data, error } = await supabase
      .from('flashcardset')
      .insert([{
        owner_id: req.user.id, // Assign the authenticated user as the owner
        title,
        description,
        visibility
      }])
      .select(); // Return the inserted data

    if (error) {
      // --- IMPORTANT: Log the FULL error object here ---
      console.error('Supabase error creating flashcard set:', error);
      // Return the full error object or a more specific message if available
      return res.status(500).json({
          error: error.message || 'Failed to create flashcard set.',
          details: error // Include full error object for debugging
      });
    }

    res.status(201).json(data[0]); // Return the created set
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add more routes for getting a specific set, updating, deleting, adding cards, etc.
// Example: Get a specific flashcard set by ID
router.get('/:setId', protectRoute, async (req, res) => {
    const { setId } = req.params;
    try {
        const { data, error } = await supabase
            .from('flashcardset')
            .select('*')
            .eq('id', setId)
            .eq('owner_id', req.user.id) // Ensure only owner can fetch (or adjust based on RLS)
            .single();

        if (error) {
            console.error('Error fetching flashcard set:', error.message);
            if (error.code === 'PGRST116') { // No rows found
                return res.status(404).json({ error: 'Flashcard set not found or not accessible.' });
            }
            return res.status(500).json({ error: error.message });
        }
        res.status(200).json(data);
    } catch (err) {
        console.error('Unexpected error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- NEW Endpoints for Individual Flashcards within a Set ---

// Helper to check if user owns the set (important for RLS and security)
async function checkSetOwnership(userId, setId) {
    const { data, error } = await supabase
        .from('flashcardset') // Use correct table name
        .select('id, owner_id')
        .eq('id', setId)
        .single();

    if (error || !data) {
        throw new Error('Flashcard set not found or not accessible.');
    }
    if (data.owner_id !== userId) {
        throw new Error('Access denied: You do not own this flashcard set.');
    }
    return true;
}

// 1. Create a new Flashcard in a Set
// POST /api/flashcards/:setId/cards
router.post('/:setId/cards', protectRoute, async (req, res) => {
    const { setId } = req.params;
    const { question, answer } = req.body;
    const userId = req.user.id;

    if (!question || !answer) {
        return res.status(400).json({ error: 'Question and answer are required for a flashcard.' });
    }

    try {
        // First, verify that the user owns the flashcard set
        await checkSetOwnership(userId, setId);

        const { data, error } = await supabase
            .from('flashcard') // Table for individual flashcards
            .insert([{
                set_id: setId,
                question,
                answer
            }])
            .select();

        if (error) {
            console.error('Supabase error creating flashcard:', error);
            return res.status(500).json({
                error: error.message || 'Failed to create flashcard.',
                details: error
            });
        }

        res.status(201).json(data[0]); // Return the created flashcard
    } catch (err) {
        console.error('Unexpected error in POST /api/flashcards/:setId/cards:', err.message);
        // Provide a more specific status code if it's an ownership error
        if (err.message.includes('Access denied')) {
            return res.status(403).json({ error: err.message });
        }
        if (err.message.includes('not found')) {
            return res.status(404).json({ error: err.message });
        }
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// 2. Get all Flashcards in a Set (similar to /api/study/:setId/all-cards, but without study progress)
// GET /api/flashcards/:setId/cards
router.get('/:setId/cards', protectRoute, async (req, res) => {
    const { setId } = req.params;
    const userId = req.user.id;

    try {
        // Verify that the user owns the flashcard set (or it's public/shared)
        const { data: flashcardSet, error: setError } = await supabase
            .from('flashcardset')
            .select('id, owner_id, visibility')
            .eq('id', setId)
            .single();

        if (setError || !flashcardSet) {
            return res.status(404).json({ error: 'Flashcard set not found.' });
        }

        // Basic authorization check (RLS should handle this too, but good to have explicit)
        if (flashcardSet.owner_id !== userId && flashcardSet.visibility === 'private') {
            // Further RLS policies could allow 'shared' access here
            return res.status(403).json({ error: 'Access denied to this flashcard set.' });
        }

        const { data, error } = await supabase
            .from('flashcard')
            .select('*')
            .eq('set_id', setId);

        if (error) {
            console.error('Supabase error fetching flashcards for set:', error);
            return res.status(500).json({ error: error.message || 'Failed to fetch flashcards.' });
        }

        res.status(200).json(data);
    } catch (err) {
        console.error('Unexpected error in GET /api/flashcards/:setId/cards:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// 3. Get a single Flashcard by ID
// GET /api/flashcards/:setId/cards/:cardId
router.get('/:setId/cards/:cardId', protectRoute, async (req, res) => {
    const { setId, cardId } = req.params;
    const userId = req.user.id;

    try {
        // Verify set ownership/access first
        const { data: flashcardSet, error: setError } = await supabase
            .from('flashcardset')
            .select('id, owner_id, visibility')
            .eq('id', setId)
            .single();

        if (setError || !flashcardSet) {
            return res.status(404).json({ error: 'Flashcard set not found.' });
        }

        if (flashcardSet.owner_id !== userId && flashcardSet.visibility === 'private') {
            return res.status(403).json({ error: 'Access denied to this flashcard set.' });
        }

        const { data, error } = await supabase
            .from('flashcard')
            .select('*')
            .eq('id', cardId)
            .eq('set_id', setId) // Ensure the card belongs to the specified set
            .single();

        if (error) {
            console.error('Supabase error fetching flashcard:', error);
            if (error.code === 'PGRST116') { // No rows found
                return res.status(404).json({ error: 'Flashcard not found in this set.' });
            }
            return res.status(500).json({ error: error.message || 'Failed to fetch flashcard.' });
        }

        res.status(200).json(data);
    } catch (err) {
        console.error('Unexpected error in GET /api/flashcards/:setId/cards/:cardId:', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// 4. Update a Flashcard
// PUT /api/flashcards/:setId/cards/:cardId
router.put('/:setId/cards/:cardId', protectRoute, async (req, res) => {
    const { setId, cardId } = req.params;
    const { question, answer } = req.body; // Allow partial updates

    if (!question && !answer) {
        return res.status(400).json({ error: 'At least question or answer must be provided for update.' });
    }

    const userId = req.user.id;

    try {
        // Verify that the user owns the flashcard set
        await checkSetOwnership(userId, setId);

        const updateData = { updated_at: new Date().toISOString() };
        if (question !== undefined) updateData.question = question;
        if (answer !== undefined) updateData.answer = answer;

        const { data, error } = await supabase
            .from('flashcard')
            .update(updateData)
            .eq('id', cardId)
            .eq('set_id', setId) // Ensure we're updating a card within the correct set
            .select();

        if (error) {
            console.error('Supabase error updating flashcard:', error);
            return res.status(500).json({
                error: error.message || 'Failed to update flashcard.',
                details: error
            });
        }

        if (data.length === 0) {
            return res.status(404).json({ error: 'Flashcard not found or not part of this set.' });
        }

        res.status(200).json(data[0]);
    } catch (err) {
        console.error('Unexpected error in PUT /api/flashcards/:setId/cards/:cardId:', err.message);
        if (err.message.includes('Access denied')) {
            return res.status(403).json({ error: err.message });
        }
        if (err.message.includes('not found')) {
            return res.status(404).json({ error: err.message });
        }
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// 5. Delete a Flashcard
// DELETE /api/flashcards/:setId/cards/:cardId
router.delete('/:setId/cards/:cardId', protectRoute, async (req, res) => {
    const { setId, cardId } = req.params;
    const userId = req.user.id;

    try {
        // Verify that the user owns the flashcard set
        await checkSetOwnership(userId, setId);

        const { error } = await supabase
            .from('flashcard')
            .delete()
            .eq('id', cardId)
            .eq('set_id', setId); // Ensure we're deleting a card within the correct set

        if (error) {
            console.error('Supabase error deleting flashcard:', error);
            return res.status(500).json({
                error: error.message || 'Failed to delete flashcard.',
                details: error
            });
        }

        // Supabase delete doesn't return data by default, check for success by affected rows
        // You might need to add .select() to check if a row was actually deleted,
        // or just assume success if no error.
        // For accurate 404 on delete, consider fetching before deleting.
        res.status(204).send(); // 204 No Content for successful deletion

    } catch (err) {
        console.error('Unexpected error in DELETE /api/flashcards/:setId/cards/:cardId:', err.message);
        if (err.message.includes('Access denied')) {
            return res.status(403).json({ error: err.message });
        }
        if (err.message.includes('not found')) {
            return res.status(404).json({ error: err.message });
        }
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router; // Export the router for use in server.js