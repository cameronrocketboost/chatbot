import { ChatPromptTemplate } from '@langchain/core/prompts';

const ROUTER_SYSTEM_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    "You are a routing assistant. Your job is to determine if a question needs document retrieval or can be answered directly.\n\nRespond with either:\n'retrieve' - if the question requires retrieving documents\n'direct' - if the question can be answered directly AND your direct answer",
  ],
  ['human', '{query}'],
]);

const RESPONSE_SYSTEM_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are an assistant for question-answering tasks. Use the following pieces of retrieved context to answer the question. 
    
    **Context:**
    {context}
    
    **Question:**
    {query}
    
    **Instructions:**
    1. Answer the user's question based *only* on the provided context.
    2. If the context is "No relevant documents were found." or similar, respond with: "I couldn't find any specific information about that in the available documents. Could you try rephrasing your question or asking about a different topic?"
    3. If the context contains suggestions (prefixed with "I couldn't find the exact document..."), synthesize the information from the suggested documents to answer the question, acknowledging that these are suggestions (e.g., "Based on similar documents I found...").
    4. If the context provides relevant information, answer the question concisely based on that information.
    5. Do not mention the context or documents explicitly unless handling suggestions (point 3).
    6. Keep your answer to a maximum of 3-4 sentences.
    `,
  ],
]);

// New prompt for evaluating retrieval quality
const EVALUATION_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are a retrieval quality evaluator. Your job is to determine if the retrieved documents effectively answer the user's query.

    **Original Query:**
    {original_query}

    **Retrieved Documents:**
    {retrieved_docs}

    **Instructions:**
    1. Analyze whether the retrieved documents contain information that directly answers the query.
    2. Consider factors like relevance, completeness, and specificity to the query.
    3. Output a JSON with two fields:
       - "quality_score": A number from 0-10 where:
         * 0-3: Poor match, documents are mostly irrelevant
         * 4-6: Partial match, some relevant information but incomplete
         * 7-10: Good match, documents contain relevant information to answer the query
       - "reasoning": Brief explanation of your score
       - "should_refine": boolean (true if score < 6, indicating we should try to refine the query)
    
    Output only valid JSON.
    `,
  ],
  ['human', '{query}'],
]);

// New prompt for refining the query
const QUERY_REFINEMENT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You are a query refinement specialist. Your job is to reformulate the user's query to improve document retrieval results.

    **Original Query:**
    {original_query}

    **Current Retrieval Results:**
    {current_docs}

    **Refinement Count:** {refinement_count}

    **Instructions:**
    1. Analyze why the current retrieval results might be inadequate.
    2. Reformulate the query to be more specific, using synonyms or alternative phrasing.
    3. If the original query mentions a document name, ensure it's preserved but try alternative formulations.
    4. If this is the second refinement attempt or more, try a more dramatic reformulation.
    5. Keep the refined query concise (1-2 sentences) and focused on the original information need.
    6. Output a JSON with:
       - "refined_query": The reformulated query
       - "reasoning": Brief explanation of your refinement strategy
    
    Output only valid JSON.
    `,
  ],
  ['human', 'Please refine this query to improve retrieval results.'],
]);

export { 
  ROUTER_SYSTEM_PROMPT, 
  RESPONSE_SYSTEM_PROMPT,
  EVALUATION_PROMPT,
  QUERY_REFINEMENT_PROMPT
};
