import express from 'express';
import { addRoutes } from '@langchain/langgraph/server';
import retrievalGraph from './retrieval_graph/graph.js';

const app = express();
app.use(express.json());
addRoutes(app, { '/retrieval': retrievalGraph });

const port = process.env.PORT || 2024;
app.listen(port, () => console.log(`Listening on ${port}`));
