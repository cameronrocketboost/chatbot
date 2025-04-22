-- Document Registry for Enhanced Document-Specific Queries
-- Add this to your Supabase database to improve document retrieval

-- Create the document registry table
CREATE TABLE document_registry (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  title TEXT,
  description TEXT,
  upload_date TIMESTAMP DEFAULT NOW(),
  document_type TEXT,
  file_size INTEGER,
  chunk_count INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  last_accessed TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for efficient querying
CREATE INDEX idx_document_registry_filename ON document_registry USING btree (filename);
CREATE INDEX idx_document_registry_title ON document_registry USING btree (title);
CREATE INDEX idx_document_registry_document_type ON document_registry USING btree (document_type);
CREATE INDEX idx_document_registry_upload_date ON document_registry USING btree (upload_date);
CREATE INDEX idx_document_registry_metadata ON document_registry USING GIN (metadata);

-- Add document_id column to documents table for linking
ALTER TABLE documents 
ADD COLUMN document_id INTEGER REFERENCES document_registry(id);

-- Create index on document_id for faster joins
CREATE INDEX idx_documents_document_id ON documents (document_id);

-- Add GIN index to metadata->source for efficient document lookups
CREATE INDEX idx_documents_source ON documents USING GIN ((metadata->'source'));

-- Function to populate document_registry from existing documents
CREATE OR REPLACE FUNCTION populate_document_registry()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_count INTEGER := 0;
  doc_record RECORD;
  chunk_count INTEGER;
  avg_chunk_size INTEGER;
BEGIN
  -- Process each unique document source
  FOR doc_record IN 
    SELECT DISTINCT 
      metadata->>'source' as filename,
      metadata->>'contentType' as document_type,
      metadata->>'parsedAt' as uploaded_at
    FROM documents
    WHERE metadata->>'source' IS NOT NULL
  LOOP
    -- Count chunks for this document
    SELECT COUNT(*) INTO chunk_count
    FROM documents
    WHERE metadata->>'source' = doc_record.filename;
    
    -- Calculate average chunk size
    SELECT FLOOR(AVG(LENGTH(content))) INTO avg_chunk_size
    FROM documents
    WHERE metadata->>'source' = doc_record.filename;
    
    -- Insert into document_registry if not exists
    INSERT INTO document_registry (
      filename,
      title,
      document_type,
      upload_date,
      chunk_count,
      file_size,
      metadata
    )
    VALUES (
      doc_record.filename,
      doc_record.filename, -- Use filename as title initially
      doc_record.document_type,
      COALESCE(doc_record.uploaded_at::timestamp, NOW()),
      chunk_count,
      avg_chunk_size * chunk_count, -- Estimate total size
      jsonb_build_object(
        'avg_chunk_size', avg_chunk_size,
        'source', doc_record.filename
      )
    )
    ON CONFLICT (filename) DO UPDATE
    SET 
      chunk_count = EXCLUDED.chunk_count,
      file_size = EXCLUDED.file_size,
      metadata = document_registry.metadata || EXCLUDED.metadata
    RETURNING id;
    
    inserted_count := inserted_count + 1;
  END LOOP;
  
  -- Update document_id in documents table
  UPDATE documents d
  SET document_id = dr.id
  FROM document_registry dr
  WHERE d.metadata->>'source' = dr.filename
  AND d.document_id IS NULL;
  
  RETURN inserted_count;
END;
$$;

-- Function to find documents by name (for document-specific queries)
CREATE OR REPLACE FUNCTION find_document_by_name(
  search_term TEXT, 
  exact_match BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id INTEGER,
  filename TEXT,
  title TEXT,
  document_type TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF exact_match THEN
    RETURN QUERY
    SELECT 
      dr.id,
      dr.filename,
      dr.title,
      dr.document_type,
      1.0::FLOAT as similarity
    FROM document_registry dr
    WHERE dr.filename = search_term
    OR dr.title = search_term
    LIMIT 1;
  ELSE
    RETURN QUERY
    SELECT 
      dr.id,
      dr.filename,
      dr.title,
      dr.document_type,
      CASE 
        WHEN dr.filename ILIKE search_term OR dr.title ILIKE search_term THEN 1.0
        WHEN dr.filename ILIKE '%' || search_term || '%' THEN 0.9
        WHEN dr.title ILIKE '%' || search_term || '%' THEN 0.8
        WHEN dr.filename % search_term THEN 0.7
        WHEN dr.title % search_term THEN 0.6
        ELSE 0.5
      END as similarity
    FROM document_registry dr
    WHERE 
      dr.filename ILIKE '%' || search_term || '%'
      OR dr.title ILIKE '%' || search_term || '%'
      OR dr.filename % search_term
      OR dr.title % search_term
    ORDER BY similarity DESC
    LIMIT 5;
  END IF;
END;
$$;

-- Enhanced document search function that prioritizes document-specific queries
CREATE OR REPLACE FUNCTION match_documents_enhanced (
  query_embedding vector(1536),
  search_query TEXT DEFAULT NULL,
  document_name TEXT DEFAULT NULL,
  match_count int DEFAULT 5,
  filter jsonb DEFAULT '{}'
) returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float,
  document_match_type TEXT
)
language plpgsql
as $$
DECLARE
  doc_id INTEGER;
  doc_filter jsonb := filter;
BEGIN
  -- If a specific document is requested, look it up first
  IF document_name IS NOT NULL AND document_name != '' THEN
    SELECT id INTO doc_id FROM find_document_by_name(document_name, FALSE) LIMIT 1;
    
    IF doc_id IS NOT NULL THEN
      -- Document found, update filter to only include this document
      doc_filter := jsonb_build_object('document_id', doc_id);
      
      -- Update last_accessed timestamp
      UPDATE document_registry SET last_accessed = NOW() WHERE id = doc_id;
    END IF;
  END IF;

  -- Return the query results
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity,
    CASE 
      WHEN doc_id IS NOT NULL THEN 'DOCUMENT_SPECIFIC'
      ELSE 'SEMANTIC_SEARCH'
    END as document_match_type
  FROM documents d
  WHERE (doc_id IS NULL OR d.document_id = doc_id)
    AND d.metadata @> COALESCE(filter, '{}'::jsonb)
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Trigger to update the document_registry when documents are added/deleted
CREATE OR REPLACE FUNCTION update_document_registry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  doc_filename TEXT;
  doc_count INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    doc_filename := NEW.metadata->>'source';
    
    -- If document exists in registry, update it
    UPDATE document_registry
    SET 
      chunk_count = chunk_count + 1,
      last_accessed = NOW()
    WHERE filename = doc_filename;
    
    -- If not, create it
    IF NOT FOUND THEN
      INSERT INTO document_registry (
        filename,
        title,
        document_type,
        chunk_count
      )
      VALUES (
        doc_filename,
        doc_filename,
        NEW.metadata->>'contentType',
        1
      );
    END IF;
    
    -- Update the document_id on the new record
    UPDATE documents
    SET document_id = (SELECT id FROM document_registry WHERE filename = doc_filename)
    WHERE id = NEW.id;
    
  ELSIF TG_OP = 'DELETE' THEN
    doc_filename := OLD.metadata->>'source';
    
    -- Count remaining chunks for this document
    SELECT COUNT(*) INTO doc_count
    FROM documents
    WHERE metadata->>'source' = doc_filename;
    
    IF doc_count > 0 THEN
      -- Update the chunk count
      UPDATE document_registry
      SET chunk_count = doc_count
      WHERE filename = doc_filename;
    ELSE
      -- No chunks left, mark document as inactive
      UPDATE document_registry
      SET is_active = FALSE
      WHERE filename = doc_filename;
    END IF;
  END IF;
  
  RETURN NULL;
END;
$$;

-- Create the trigger
CREATE TRIGGER tr_documents_update_registry
AFTER INSERT OR DELETE ON documents
FOR EACH ROW
EXECUTE FUNCTION update_document_registry(); 