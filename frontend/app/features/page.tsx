'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Brain, FileText, Network, Search, Filter, Infinity, Code, BarChart } from 'lucide-react';

export default function FeaturesPage() {
  return (
    <div className="container py-8 max-w-6xl">
      <div className="space-y-2 mb-8">
        <h1 className="text-3xl font-bold">System Features & Architecture</h1>
        <p className="text-muted-foreground">
          A technical overview of the advanced capabilities powering this document intelligence system
        </p>
      </div>

      <Tabs defaultValue="langgraph" className="w-full">
        <TabsList className="grid grid-cols-4 mb-8">
          <TabsTrigger value="langgraph">LangGraph Architecture</TabsTrigger>
          <TabsTrigger value="retrieval">Retrieval System</TabsTrigger>
          <TabsTrigger value="ingestion">Ingestion Pipeline</TabsTrigger>
          <TabsTrigger value="features">Frontend Features</TabsTrigger>
        </TabsList>
        
        <TabsContent value="langgraph" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Network className="h-5 w-5 text-blue-500" /> 
                    LangGraph Orchestration
                  </CardTitle>
                  <CardDescription>
                    State-machine based workflow orchestration for advanced AI agent behavior
                  </CardDescription>
                </div>
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                  Core Architecture
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-2">Graph Architecture</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  The system leverages two primary LangGraph state machines to orchestrate the document processing and retrieval workflows:
                </p>
                
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Ingestion Graph</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm pt-0">
                      <p className="mb-2">Handles document processing with these nodes:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Document Type Detection</li>
                        <li>Content Extraction</li>
                        <li>Chunking & Splitting</li>
                        <li>Embedding Generation</li>
                        <li>Vector Store Insertion</li>
                      </ul>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Retrieval Graph</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm pt-0">
                      <p className="mb-2">Orchestrates query processing with these nodes:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Query Type Classification</li>
                        <li>Query Filter Extraction</li>
                        <li>Document Retrieval</li>
                        <li>Query Refinement Loop</li>
                        <li>Response Generation</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
              
              <Separator />
              
              <div>
                <h3 className="text-lg font-medium mb-2">Advanced Graph Features</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                    <h4 className="font-medium text-blue-800 mb-1">Query Refinement Loop</h4>
                    <p className="text-xs text-blue-700">
                      Cyclic retrieval-reflection-refinement process that iteratively improves search results when initial matches are poor
                    </p>
                  </div>
                  
                  <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
                    <h4 className="font-medium text-purple-800 mb-1">Self-Reflection</h4>
                    <p className="text-xs text-purple-700">
                      Evaluates relevance and quality of retrieved documents, makes decisions about reformulation or retrieval strategies
                    </p>
                  </div>
                  
                  <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                    <h4 className="font-medium text-green-800 mb-1">Multi-Stage Reasoning</h4>
                    <p className="text-xs text-green-700">
                      Explicitly separated reasoning stages with dedicated thinking modules for improved transparency and accuracy
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                <h4 className="font-medium text-base mb-2">Real-time Thinking Updates</h4>
                <p className="text-sm text-gray-600 mb-2">
                  All LangGraph nodes emit real-time status updates that are streamed to the frontend, providing users with
                  transparency into the AI's thinking process via Server-Sent Events (SSE).
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="retrieval" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Search className="h-5 w-5 text-green-500" /> 
                    Advanced Retrieval System
                  </CardTitle>
                  <CardDescription>
                    Multi-stage retrieval with hybrid search, adaptive matching, and context management
                  </CardDescription>
                </div>
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  Core Engine
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-2">Fuzzy Matching & Document Filtering</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <h4 className="font-medium mb-1">Levenshtein Distance Matching</h4>
                    <p className="text-sm text-slate-600 mb-2">
                      Implementation of dynamic string similarity scoring using the Levenshtein algorithm for fuzzy document name matching.
                    </p>
                    <div className="text-xs bg-slate-100 p-2 rounded font-mono">
                      {`// Dynamic threshold based on string length
const threshold = getDynamicLevenshteinThreshold(query.length);
// Returns smaller thresholds for shorter strings
// and larger thresholds for longer strings`}
                    </div>
                  </div>
                  
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <h4 className="font-medium mb-1">Confidence Scoring</h4>
                    <p className="text-sm text-slate-600 mb-2">
                      Confidence-based ranking system that prioritizes high-quality matches and filters out unreliable ones.
                    </p>
                    <div className="text-xs bg-slate-100 p-2 rounded font-mono">
                      {`// Calculate match confidence (0-1 scale)
const confidence = calculateMatchConfidence(query, docName);
// Filter results with confidence below threshold
if (confidence < 0.6) return false;`}
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                    <h4 className="font-medium text-green-800 mb-1">Regex Pattern Extraction</h4>
                    <p className="text-xs text-green-700">
                      Advanced regex patterns identify potential document references in natural language queries
                    </p>
                  </div>
                  
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                    <h4 className="font-medium text-blue-800 mb-1">Multi-Stage Filtering</h4>
                    <p className="text-xs text-blue-700">
                      Cascading filter chain with fallbacks for exact match → fuzzy match → semantic search
                    </p>
                  </div>
                  
                  <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
                    <h4 className="font-medium text-purple-800 mb-1">Content Type Detection</h4>
                    <p className="text-xs text-purple-700">
                      Automatic detection of requests for specific file types (PDF, PPTX, DOCX) in queries
                    </p>
                  </div>
                </div>
              </div>
              
              <Separator />
              
              <div>
                <h3 className="text-lg font-medium mb-2">Contextual Retrieval Techniques</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Hybrid Retrieval</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm pt-0">
                      <p className="mb-2">Combines multiple retrieval strategies:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Vector similarity search (embeddings)</li>
                        <li>Keyword matching for key terms</li>
                        <li>Metadata filtering (date, type, source)</li>
                        <li>Chunk re-ranking based on relevance</li>
                      </ul>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Context Management</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm pt-0">
                      <p className="mb-2">Advanced context tracking features:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Sliding context window for large docs</li>
                        <li>Parent-child relationships between chunks</li>
                        <li>Document structure preservation</li>
                        <li>Chunk grouping for related content</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="ingestion" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-purple-500" /> 
                    Document Ingestion Pipeline
                  </CardTitle>
                  <CardDescription>
                    Robust document processing with specialized handling for different file types
                  </CardDescription>
                </div>
                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                  Processing Engine
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-2">Multi-Format Document Processing</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-red-50 p-4 rounded-lg border border-red-100">
                    <h4 className="font-medium text-red-800 mb-1">PDF Processing</h4>
                    <p className="text-xs text-red-700">
                      Advanced PDF parsing with table extraction, metadata preservation, and page boundary mapping
                    </p>
                  </div>
                  
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                    <h4 className="font-medium text-blue-800 mb-1">Word Document (DOCX)</h4>
                    <p className="text-xs text-blue-700">
                      Structured document processing with section recognition, heading hierarchy, and style preservation
                    </p>
                  </div>
                  
                  <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                    <h4 className="font-medium text-green-800 mb-1">PowerPoint (PPTX)</h4>
                    <p className="text-xs text-green-700">
                      Slide-based content extraction with slide structure preservation and specialized handling for presentations
                    </p>
                  </div>
                </div>
              </div>
              
              <Separator />
              
              <div>
                <h3 className="text-lg font-medium mb-2">Advanced Chunking Strategy</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Semantic Chunking</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm pt-0">
                      <p className="mb-2">Intelligent document splitting features:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Preservation of semantic units</li>
                        <li>25% chunk overlap for context continuity</li>
                        <li>Hierarchical chunking that maintains structure</li>
                        <li>Custom separators by document type</li>
                      </ul>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Metadata Enrichment</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm pt-0">
                      <p className="mb-2">Rich metadata enhancement:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Document-level metadata preservation</li>
                        <li>Position tracking (chunk index, total)</li>
                        <li>Structural information (headings, sections)</li>
                        <li>Processing timestamps and version info</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                <h4 className="font-medium text-base mb-2">Performance Optimizations</h4>
                <p className="text-sm text-gray-600 mb-2">
                  The ingestion pipeline includes several optimizations for handling large documents:
                </p>
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div className="bg-white p-2 rounded border">
                    <span className="font-medium">Size Limit Checks</span>
                    <p className="text-gray-500 mt-1">Automatic validation to prevent processing files too large for the system</p>
                  </div>
                  <div className="bg-white p-2 rounded border">
                    <span className="font-medium">Progress Tracking</span>
                    <p className="text-gray-500 mt-1">Real-time progress indicators with time remaining estimation</p>
                  </div>
                  <div className="bg-white p-2 rounded border">
                    <span className="font-medium">Memory Management</span>
                    <p className="text-gray-500 mt-1">Efficient handling of base64 content to prevent memory exhaustion</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="features" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-orange-500" /> 
                    Frontend Intelligence Features
                  </CardTitle>
                  <CardDescription>
                    User-facing features that showcase the system's advanced capabilities
                  </CardDescription>
                </div>
                <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                  User Experience
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-2">Transparent AI Processing</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-100">
                    <h4 className="font-medium text-yellow-800 mb-1">Thinking Indicators</h4>
                    <p className="text-xs text-yellow-700">
                      Real-time updates showing the AI's current processing stage and thinking rationale
                    </p>
                  </div>
                  
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                    <h4 className="font-medium text-blue-800 mb-1">Source Citations</h4>
                    <p className="text-xs text-blue-700">
                      Interactive source displays with document metadata, chunk positioning, and content previews
                    </p>
                  </div>
                  
                  <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                    <h4 className="font-medium text-green-800 mb-1">Filter Indicators</h4>
                    <p className="text-xs text-green-700">
                      Visual cues showing when document filters are applied to search results
                    </p>
                  </div>
                </div>
              </div>
              
              <Separator />
              
              <div>
                <h3 className="text-lg font-medium mb-2">Document Management</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Document Explorer</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm pt-0">
                      <p className="mb-2">Advanced document viewing features:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Hierarchical document visualization</li>
                        <li>Chunk-level metadata inspection</li>
                        <li>Content categorization by document type</li>
                        <li>Detailed metadata exploration</li>
                      </ul>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">Upload Processing</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm pt-0">
                      <p className="mb-2">Intelligent file handling:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        <li>Multi-file batch uploading</li>
                        <li>Detailed progress tracking</li>
                        <li>File validation and type detection</li>
                        <li>Duplicate prevention</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                <h4 className="font-medium text-base mb-2">Technical Implementation Highlights</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Code className="h-4 w-4 text-indigo-600" />
                      <h5 className="font-medium text-indigo-800 text-sm">Server-Sent Events</h5>
                    </div>
                    <p className="text-xs text-indigo-700">
                      Real-time streaming updates from backend to frontend for continuous processing feedback
                    </p>
                  </div>
                  
                  <div className="bg-teal-50 p-3 rounded-lg border border-teal-100">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Infinity className="h-4 w-4 text-teal-600" />
                      <h5 className="font-medium text-teal-800 text-sm">Thread Management</h5>
                    </div>
                    <p className="text-xs text-teal-700">
                      Persistent chat sessions with LangGraph thread ID tracking for continuous conversations
                    </p>
                  </div>
                  
                  <div className="bg-rose-50 p-3 rounded-lg border border-rose-100">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <BarChart className="h-4 w-4 text-rose-600" />
                      <h5 className="font-medium text-rose-800 text-sm">Responsive Design</h5>
                    </div>
                    <p className="text-xs text-rose-700">
                      Adaptive interface that works seamlessly across devices with optimized mobile experience
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 