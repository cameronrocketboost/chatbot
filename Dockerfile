FROM langchain/langgraphjs-api:20
ADD . /deps/backend
ENV LANGSERVE_GRAPHS='{"ingestion_graph":"./src/ingestion_graph/graph.ts:graph","retrieval_graph":"./src/retrieval_graph/graph.ts:graph"}'
WORKDIR /deps/backend
RUN npm i
RUN (test ! -f /api/langgraph_api/js/build.mts && echo "Prebuild script not found, skipping") || tsx /api/langgraph_api/js/build.mts