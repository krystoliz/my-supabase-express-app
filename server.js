import dotenv from 'dotenv'; 
dotenv.config(); // Load environment variables from .env file
import express from 'express';
import cors from 'cors'
import {supabase, supabaseAdmin} from './src/config/supabaseClient.js'; // Import Supabase clients

// Import route modules
import authRoutes from './src/routes/authRoutes.js';
import flashcardRoutes from './src/routes/flashcardRoutes.js'; // Example for other routes
import studyRoutes from './src/routes/studyRoutes.js'; // <-- NEW: Import study routes
import llmRoutes from './src/routes/llmRoutes.js';

const app = express();
const port = process.env.PORT || 3000;

// Configure CORS
const corsOptions = {
  origin: [
    'http://localhost:3000', // Allow your local frontend
    'https://my-supabase-next-app.vercel.app' // Add your deployed frontend URL here when you deploy it
  ],
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // Allow cookies to be sent
  optionsSuccessStatus: 204 // Some legacy browsers (IE11, various SmartTVs) choke on 200
};
app.use(cors(corsOptions)); // <--- USE CORS MIDDLEWARE HERE

// Global Middleware
app.use(express.json()); // Body parser for JSON requests
app.use(express.urlencoded({ extended: true })); // Body parser for URL-encoded requests (optional, but good practice)


// Health check route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'API is running' });
});

// Mount Route Modules
app.use('/auth', authRoutes); // All routes defined in authRoutes will be prefixed with /auth
app.use('/api/flashcards', flashcardRoutes); // Example: Prefix flashcard routes with /api/flashcards
app.use('/api/study', studyRoutes);
app.use('/api/llm', llmRoutes);      // <-- NEW: Use this for LLM operations

// Basic error handling middleware (optional, but good practice for unhandled errors)
app.use((err, req, res, next) => {
  console.error(err.stack); // Log the error stack for debugging
  res.status(500).send('Something broke!');
});

// Start the server
app.listen(port, () => {
  console.log(`Express server running on http://localhost:${port}`);
  console.log('Supabase URL:', process.env.SUPABASE_URL ? 'Loaded' : 'Not loaded');
});