// src/routes/llmRoutes.js
import express from 'express'; // Use ES6 import syntax for consistency
const router = express.Router();
import fetch from 'node-fetch'; // Ensure node-fetch is installed and imported correctly
import { supabaseAdmin } from '../config/supabaseClient.js';
import { protectRoute } from '../middleware/authMiddleware.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use the full model name found from listModels
const LLM_MODEL = 'gemini-2.0-flash-thinking-exp-1219'; // <--- CORRECTED MODEL NAME
const GENERATE_CONTENT_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${GEMINI_API_KEY}`; // Ensure LLM_MODEL is used here
// 1.3. POST /api/llm/generate-flashcards-with-llm
router.post('/generate-flashcards-with-llm', protectRoute, async (req, res) => {
    const { prompt, setId, count = 5 } = req.body;
    const userId = req.user.id;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required to generate flashcards.' });
    }
    if (!setId) {
        return res.status(400).json({ error: 'Flashcard Set ID is required to associate generated flashcards.' });
    }
    if (!GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY is not set in environment variables.");
        return res.status(500).json({ error: 'Server configuration error: LLM API key missing.' });
    }

    try {
        const messages = [
            {
                role: "user",
                parts: [{
                    text: `Generate ${count} unique flashcards about "${prompt}". Each flashcard must have a 'question' and an 'answer'. Respond ONLY with a JSON array of objects, where each object has a 'question' and an 'answer' field. Example: [{"question": "What is the capital of France?", "answer": "Paris"}, {"question": "...", "answer": "..."}]. DO NOT include any other text, markdown formatting outside the JSON, or conversational filler.`
                }]
            }
        ];

        const llmResponse = await fetch(GENERATE_CONTENT_ENDPOINT, { // <--- Use the corrected full endpoint
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: messages,
                generationConfig: {
                    maxOutputTokens: 1000,
                    temperature: 0.7,
                    responseMimeType: "application/json"
                },
                safetySettings: [
                    {
                        category: "HARM_CATEGORY_HARASSMENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE",
                    },
                    {
                        category: "HARM_CATEGORY_HATE_SPEECH",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE",
                    },
                    {
                        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE",
                    },
                    {
                        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                        threshold: "BLOCK_MEDIUM_AND_ABOVE",
                    },
                ],
            })
        });

        if (!llmResponse.ok) {
            const errorBody = await llmResponse.text();
            console.error(`Gemini API Error: ${llmResponse.status} - ${errorBody}`);
            return res.status(llmResponse.status).json({
                error: `Failed to get response from LLM API: ${llmResponse.statusText}`,
                details: errorBody
            });
        }

        const llmJson = await llmResponse.json();
        
        let llmGeneratedText = '';
        if (llmJson.candidates && llmJson.candidates[0] && llmJson.candidates[0].content && llmJson.candidates[0].content.parts && llmJson.candidates[0].content.parts[0] && llmJson.candidates[0].content.parts[0].text) {
             llmGeneratedText = llmJson.candidates[0].content.parts[0].text;
        } else if (llmJson.content && llmJson.content.parts && llmJson.content.parts[0] && llmJson.content.parts[0].text) {
            llmGeneratedText = llmJson.content.parts[0].text;
        } else {
            console.error('Unexpected Gemini response structure:', llmJson);
            return res.status(500).json({ error: 'LLM returned an unexpected format.' });
        }


        let generatedFlashcards;
        try {
            generatedFlashcards = JSON.parse(llmGeneratedText);
            if (!Array.isArray(generatedFlashcards)) {
                throw new Error("LLM did not return a JSON array as expected after parsing.");
            }
            generatedFlashcards = generatedFlashcards.filter(fc => fc.question && fc.answer);
        } catch (parseError) {
            console.error('Failed to parse LLM generated content as JSON:', parseError);
            console.error('Raw LLM content:', llmGeneratedText);
            if (llmJson.promptFeedback && llmJson.promptFeedback.blockReason) {
                return res.status(400).json({ error: `Prompt blocked by safety settings: ${llmJson.promptFeedback.blockReason}` });
            }
            return res.status(500).json({ error: 'LLM generated invalid JSON format. Please try again or refine your prompt.' });
        }
        
        if (generatedFlashcards.length === 0) {
            return res.status(400).json({ error: 'LLM did not generate any valid flashcards from the prompt. Try a different prompt.' });
        }

        const flashcardsToInsert = generatedFlashcards.map(fc => ({
            set_id: setId,
            question: fc.question,
            answer: fc.answer
        }));

        const { data: insertedFlashcards, error: insertError } = await supabaseAdmin
            .from('flashcard')
            .insert(flashcardsToInsert)
            .select();

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

export default router;