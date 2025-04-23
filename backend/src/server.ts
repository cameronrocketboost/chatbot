import { graph as ingestion_graph } from './ingestion_graph/graph.js';
import { graph as retrieval_graph } from './retrieval_graph/graph.js';
import { addRoutes } from '@langchain/langgraph';
import express from 'express';
import { RunnableConfig } from '@langchain/core/runnables';
import { BaseCheckpointSaver } from '@langchain/langgraph'; // Assuming MemorySaver or specific saver is used in graphs
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' }); // Load root .env file if needed, adjust path as necessary

const app = express();
const port = process.env.PORT || 2024;

// --- CORS Configuration ---
// Load allowed origins from environment variable, default to allow all for simplicity (adjust for production)
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    // Allow all origins if set to '*', otherwise check against the list
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // If you need to handle cookies or authorization headers
}));

// Middleware to parse JSON bodies
app.use(express.json());

// --- Add LangGraph routes --- 
// Assumes your graphs use a compatible checkpointer (e.g., MemorySaver initialized within them)
// If checkpointer is configured externally, you might need to pass it here.

addRoutes(app, retrieval_graph, {
    path: '/retrieval', // Expose retrieval graph at /retrieval
    config: (req: express.Request) => {
        // Example: Extract thread_id from request body or headers
        // You might need to adjust this based on how your frontend sends the thread ID
        const threadId = req.body?.thread_id || req.headers['x-thread-id']; 
        const config: RunnableConfig = {
            configurable: {
                thread_id: threadId || undefined, // Pass thread_id if available
                // Add other configurable fields if needed (e.g., userId)
            },
        };
        return config;
    },
    // inputKeys?: string | string[] | undefined; // Specify if graph expects specific input keys
    // outputKeys?: string | string[] | undefined; // Specify if you want to expose specific output keys
    // streamMode?: "values" | "updates" | "messages" | "states" | undefined;
});

addRoutes(app, ingestion_graph, {
    path: '/ingest', // Expose ingestion graph at /ingest
    // Add config or other options for ingestion if needed
});

// Basic health check endpoint
app.get('/', (req, res) => {
  res.send('LangGraph Backend is running!');
});

// --- Start Server --- 
app.listen(port, () => {
  console.log(`LangGraph server listening on port ${port}`);
}); 