require('dotenv').config(); // Load environment variables first
const express = require('express');
const cors = require('cors'); // Import CORS middleware for handling cross-origin requests
const { supabase, supabaseAdmin } = require('./src/config/supabaseClient'); // Import Supabase clients

// Import route modules
const authRoutes = require('./src/routes/authRoutes');
const flashcardRoutes = require('./src/routes/flashcardRoutes'); // Example for other routes
const studyRoutes = require('./src/routes/studyRoutes'); // <-- NEW: Import study routes

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
app.use('/api/study', studyRoutes); // <-- NEW: Use this for study mode operations

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