// src/routes/llmRoutes.js
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // Import node-fetch
const { supabaseAdmin } = require('../config/supabaseClient'); // Need supabaseAdmin to bypass RLS for inserts
const { protectRoute } = require('../middleware/authMiddleware'); // For protecting the route

// DeepSeek API configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions'; // Or 'https://api.deepseek.com/v1/chat/completions'
const LLM_MODEL = 'deepseek-chat'; // Or 'deepseek-coder', 'deepseek-reasoner' depending on preference

// 1.3. POST /api/llm/generate-flashcards-with-llm
router.post('/generate-flashcards-with-llm', protectRoute, async (req, res) => {
    const { prompt, setId, count = 5 } = req.body; // 'count' is optional, default to 5
    const userId = req.user.id;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required to generate flashcards.' });
    }
    if (!setId) {
        return res.status(400).json({ error: 'Flashcard Set ID is required to associate generated flashcards.' });
    }
    if (!DEEPSEEK_API_KEY) {
        console.error("DEEPSEEK_API_KEY is not set in environment variables.");
        return res.status(500).json({ error: 'Server configuration error: LLM API key missing.' });
    }

    try {
        // Step 1: Instruct LLM to generate flashcards
        // Define a structured prompt to guide the LLM's output
        const messages = [
            {
                role: "system",
                content: `You are an expert flashcard generator. Based on the user's request, create ${count} unique flashcards. Each flashcard should have a 'question' and an 'answer'. The response MUST be a JSON array of objects, where each object has a 'question' and an 'answer' field. Do not include any other text or formatting. Example: [{"question": "...", "answer": "..."}, {"question": "...", "answer": "..."}].`
            },
            {
                role: "user",
                content: `Generate ${count} flashcards about: ${prompt}`
            }
        ];

        const llmResponse = await fetch(DEEPSEEK_BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: messages,
                max_tokens: 1000, // Adjust as needed
                temperature: 0.7, // Adjust for creativity vs. consistency
                response_format: { type: "json_object" } // Request JSON object output
            })
        });

        if (!llmResponse.ok) {
            const errorBody = await llmResponse.text();
            console.error(`DeepSeek API Error: ${llmResponse.status} - ${errorBody}`);
            return res.status(llmResponse.status).json({
                error: `Failed to get response from LLM API: ${llmResponse.statusText}`,
                details: errorBody
            });
        }

        const llmJson = await llmResponse.json();
        const llmGeneratedContent = llmJson.choices[0].message.content;

        let generatedFlashcards;
        try {
            // Attempt to parse the content as JSON. LLM might wrap it in markdown.
            generatedFlashcards = JSON.parse(llmGeneratedContent.replace(/```json\n|\n```/g, ''));
            if (!Array.isArray(generatedFlashcards)) {
                throw new Error("LLM did not return a JSON array as expected.");
            }
            generatedFlashcards = generatedFlashcards.filter(fc => fc.question && fc.answer); // Basic validation
        } catch (parseError) {
            console.error('Failed to parse LLM generated content as JSON:', parseError);
            console.error('Raw LLM content:', llmGeneratedContent);
            return res.status(500).json({ error: 'LLM generated invalid format. Please try again or refine your prompt.' });
        }
        
        if (generatedFlashcards.length === 0) {
            return res.status(400).json({ error: 'LLM did not generate any valid flashcards from the prompt. Try a different prompt.' });
        }

        // Step 2: Insert generated flashcards into Supabase
        const flashcardsToInsert = generatedFlashcards.map(fc => ({
            set_id: setId,
            question: fc.question,
            answer: fc.answer
            // owner_id is not directly needed here as RLS on flashcard table might handle this,
            // but if flashcard table has owner_id, it should come from set's owner or current user.
            // For now, assuming flashcard belongs to the set owner.
        }));

        const { data: insertedFlashcards, error: insertError } = await supabaseAdmin
            .from('flashcard')
            .insert(flashcardsToInsert)
            .select(); // Return the inserted data

        if (insertError) {
            console.error('Supabase error inserting generated flashcards:', insertError);
            return res.status(500).json({
                error: insertError.message || 'Failed to save generated flashcards.',
                details: insertError
            });
        }

        res.status(200).json({
            message: `Successfully generated and saved ${insertedFlashcards.length} flashcards.`,
            flashcards: insertedFlashcards
        });

    } catch (err) {
        console.error('Unexpected error in LLM generation route:', err);
        res.status(500).json({ error: 'Internal server error during flashcard generation.' });
    }
});

module.exports = router;