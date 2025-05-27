// src/routes/studyRoutes.js
const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/supabaseClient'); // Need both for some operations
const { protectRoute } = require('../middleware/authMiddleware');

// --- Helper function for SM-2 calculation (on the backend) ---
function calculateSM2(qualityOfResponse, currentEaseFactor, currentRepetitions, currentInterval) {
    let newEaseFactor = currentEaseFactor;
    let newRepetitions = currentRepetitions;
    let newInterval = currentInterval;

    if (qualityOfResponse >= 3) { // Correct response
        if (newRepetitions === 0) {
            newInterval = 1;
        } else if (newRepetitions === 1) {
            newInterval = 6;
        } else {
            newInterval = Math.round(newInterval * newEaseFactor);
        }
        newRepetitions++;
        newEaseFactor = newEaseFactor - 0.8 + 0.28 * qualityOfResponse - 0.02 * qualityOfResponse * qualityOfResponse;
        if (newEaseFactor < 1.3) {
            newEaseFactor = 1.3;
        }
    } else { // Incorrect response
        newRepetitions = 0;
        newInterval = 1; // Or 0, to make it due immediately today depending on exact Anki variant
        // newEaseFactor remains unchanged or is calculated as above but usually it's reset to 1.3 for 0-2 quality
        // Anki's SM-2 logic tends to adjust EF only for q >= 3. For q < 3, it resets repetitions and interval.
        // For simplicity, we'll follow a common interpretation where EF isn't changed for q < 3 unless you score a 3 after a lapse.
        // If you want to strictly adhere to Anki's behavior, sometimes EF can drop if you get below a 3 after a correct streak.
        // For now, EF only changes with q >= 3.
    }

    // Ensure interval is at least 1 day if repetitions > 0, to prevent division by zero or infinite loop in UI
    if (newInterval < 1 && newRepetitions > 0) {
        newInterval = 1;
    }

    // Calculate next review date
    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);

    return {
        newEaseFactor: parseFloat(newEaseFactor.toFixed(2)), // Store with 2 decimal places
        newRepetitions,
        newInterval,
        nextReviewDate: nextReviewDate.toISOString() // Store as ISO string
    };
}


// 1. Get Cards for Review (for a specific set) - NOW WITH TWO QUERIES
router.get('/:setId/review-cards', protectRoute, async (req, res) => {
    const { setId } = req.params;
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of today for comparison

    try {
        // First, check if the set exists and belongs to the user or is public/shared
        const { data: flashcardSet, error: setError } = await supabase
            .from('flashcardset') // Use the correct table name
            .select('id, owner_id, visibility')
            .eq('id', setId)
            .single();

        if (setError || !flashcardSet) {
            return res.status(404).json({ error: 'Flashcard set not found.' });
        }

        // Basic authorization check (RLS should ideally handle this too)
        if (flashcardSet.owner_id !== userId && flashcardSet.visibility === 'private') {
            return res.status(403).json({ error: 'Access denied to this flashcard set.' });
        }

        let allCards = [];
        let errorFetchingCards = null;

        // --- Query 1: Get cards that have NO study progress for this user ---
        // Fetch all flashcard IDs for the set
        const { data: allFlashcardIdsInSet, error: idsError } = await supabase
            .from('flashcard')
            .select('id')
            .eq('set_id', setId);

        if (idsError) {
            errorFetchingCards = idsError;
        } else {
            const flashcardIds = allFlashcardIdsInSet.map(card => card.id);

            // Fetch progress records that *do* exist for this user for these cards
            const { data: existingProgressIds, error: existingProgressError } = await supabase
                .from('studyprogress') // Use correct table name
                .select('flashcard_id')
                .eq('user_id', userId)
                .in('flashcard_id', flashcardIds);

            if (existingProgressError) {
                errorFetchingCards = existingProgressError;
            } else {
                const existingCardIds = existingProgressIds.map(p => p.flashcard_id);

                // Find card IDs that are in the set but NOT in existingProgressIds
                const newCardIds = flashcardIds.filter(id => !existingCardIds.includes(id));

                if (newCardIds.length > 0) {
                    const { data: newCards, error: newCardsError } = await supabase
                        .from('flashcard')
                        .select(`
                            *,
                            studyprogress!left(
                                ease_factor,
                                repetitions,
                                interval,
                                next_review_date,
                                last_reviewed,
                                user_id
                            )
                        `)
                        .in('id', newCardIds)
                        .eq('set_id', setId); // Add set_id filter for safety

                    if (newCardsError) {
                        errorFetchingCards = newCardsError;
                    } else {
                        allCards = allCards.concat(newCards.map(card => ({
                            ...card,
                            // *** CORRECTED LINE FOR NEW CARDS ***
                            studyProgress: card.studyprogress && card.studyprogress[0] ? card.studyprogress[0] : null
                        })));
                    }
                }
            }
        }

        // --- Query 2: Get cards that DO have study progress for this user AND are due ---
        if (!errorFetchingCards) {
            const { data: dueCards, error: dueCardsError } = await supabase
                .from('flashcard')
                .select(`
                    *,
                    studyprogress!inner(
                        ease_factor,
                        repetitions,
                        interval,
                        next_review_date,
                        last_reviewed,
                        user_id
                    )
                `)
                .eq('set_id', setId)
                .eq('studyprogress.user_id', userId) // Filter the join to only include THIS user's progress
                .lte('studyprogress.next_review_date', today.toISOString())
                .order('next_review_date', { ascending: true, referencedTable: 'studyprogress' }); // <--- CORRECTED

            if (dueCardsError) {
                errorFetchingCards = dueCardsError;
            } else {
                allCards = allCards.concat(dueCards.map(card => ({
                    ...card,
                    // *** CORRECTED LINE FOR DUE CARDS ***
                    studyProgress: card.studyprogress && card.studyprogress[0] ? card.studyprogress[0] : null
                })));
            }
        }


        if (errorFetchingCards) {
            console.error('Error fetching cards for review (combined queries):', errorFetchingCards.message, 'Details:', errorFetchingCards.details);
            return res.status(500).json({ error: errorFetchingCards.message || 'Failed to fetch cards for review.', details: errorFetchingCards.details });
        }

        // Sort all cards by next_review_date, nulls (new cards) first
        const sortedCards = allCards.sort((a, b) => {
            const dateA = a.studyProgress?.next_review_date ? new Date(a.studyProgress.next_review_date).getTime() : 0; // 0 for nulls, effectively putting them first
            const dateB = b.studyProgress?.next_review_date ? new Date(b.studyProgress.next_review_date).getTime() : 0;
            return dateA - dateB;
        });

        // Apply limit after combining and sorting
        res.status(200).json(sortedCards.slice(0, 20));


    } catch (err) {
        console.error('Unexpected error in /:setId/review-cards GET:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// 2. Record Review (Update StudyProgress)
router.post('/record-review', protectRoute, async (req, res) => {
    const { flashcard_id, quality_of_response } = req.body;
    const userId = req.user.id;

    if (flashcard_id === undefined || quality_of_response === undefined || quality_of_response < 0 || quality_of_response > 5) {
        return res.status(400).json({ error: 'flashcard_id and quality_of_response (0-5) are required.' });
    }

    try {
        // 1. Get current study progress for the card (or initialize if not exists)
        const { data: currentProgress, error: fetchError } = await supabase
            .from('studyprogress')
            .select('*')
            .eq('user_id', userId)
            .eq('flashcard_id', flashcard_id)
            .single();

        let easeFactor = currentProgress ? currentProgress.ease_factor : 2.5;
        let repetitions = currentProgress ? currentProgress.repetitions : 0;
        let interval = currentProgress ? currentProgress.interval : 0;

        // 2. Calculate new SM-2 parameters
        const { newEaseFactor, newRepetitions, newInterval, nextReviewDate } =
            calculateSM2(quality_of_response, easeFactor, repetitions, interval);

        const updateData = {
            ease_factor: newEaseFactor,
            repetitions: newRepetitions,
            interval: newInterval,
            next_review_date: nextReviewDate,
            last_reviewed: new Date().toISOString(),
            user_id: userId,        // Ensure these are always set for insert/upsert
            flashcard_id: flashcard_id // Ensure these are always set for insert/upsert
        };

        // 3. Upsert (update or insert) the StudyProgress record
        const { data: updatedProgress, error: upsertError } = await supabaseAdmin // Use supabaseAdmin for upsert to bypass RLS potentially on StudyProgress if needed
            .from('studyprogress')
            .upsert(updateData, { onConflict: 'user_id,flashcard_id' }) // Upsert based on the unique constraint
            .select();

        if (upsertError) {
            console.error('Error upserting study progress:', upsertError);
            return res.status(500).json({ error: upsertError.message || 'Failed to update study progress.' });
        }

        res.status(200).json({
            message: 'Study progress updated successfully.',
            progress: updatedProgress[0]
        });

    } catch (err) {
        console.error('Unexpected error in /record-review POST:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// 3. Get All Flashcards in a Set (for Browse/initial view)
router.get('/:setId/all-cards', protectRoute, async (req, res) => {
    const { setId } = req.params;
    const userId = req.user.id; // Still good to know who's asking, for RLS purposes

    try {
        // Basic authorization check for the set itself
        const { data: flashcardSet, error: setError } = await supabase
            .from('flashcardset') // Use correct table name
            .select('id, owner_id, visibility')
            .eq('id', setId)
            .single();

        if (setError || !flashcardSet) {
            return res.status(404).json({ error: 'Flashcard set not found.' });
        }

        if (flashcardSet.owner_id !== userId && flashcardSet.visibility === 'private') {
            return res.status(403).json({ error: 'Access denied to this flashcard set.' });
        }

        // Fetch all cards for the set
        const { data: allCards, error: cardsError } = await supabase
            .from('flashcard') // Use correct table name
            .select(`
                *,
                studyprogress!left(
                    ease_factor,
                    repetitions,
                    interval,
                    next_review_date,
                    last_reviewed
                )
            `)
            .eq('set_id', setId)
            .eq('StudyProgress.user_id', userId); // Link progress to THIS user

        if (cardsError) {
            console.error('Error fetching all cards for set:', cardsError.message);
            return res.status(500).json({ error: cardsError.message });
        }

        // Map data to ensure StudyProgress is an object, not an array
        const formattedCards = allCards.map(card => ({
            ...card,
            studyProgress: card.StudyProgress.length > 0 ? card.StudyProgress[0] : null
        }));

        res.status(200).json(formattedCards);

    } catch (err) {
        console.error('Unexpected error in /:setId/all-cards GET:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


module.exports = router;