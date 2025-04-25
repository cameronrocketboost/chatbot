import { ChatPromptTemplate } from '@langchain/core/prompts';

// System prompt for generating responses based on retrieved content
export const RESPONSE_SYSTEM_PROMPT = ChatPromptTemplate.fromMessages([
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
export const EVALUATION_PROMPT = ChatPromptTemplate.fromMessages([
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
