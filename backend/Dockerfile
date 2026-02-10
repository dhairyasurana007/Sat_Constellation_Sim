# =============================================================================
# Backend Dockerfile - FastAPI + React Static Files
# =============================================================================

# Stage 1: Build Frontend
FROM node:18-alpine AS frontend-builder

WORKDIR /app

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

ARG VITE_CESIUM_TOKEN
ENV VITE_CESIUM_TOKEN=$VITE_CESIUM_TOKEN

RUN npm run build

# Stage 2: Production
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ .

# Copy frontend build from Stage 1
COPY --from=frontend-builder /app/dist ./static

# Expose port
EXPOSE 8000

# Run with uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]