#!/bin/bash
# Quick setup and run script for SanchaarSetu demo

set -e

echo "📦 Building and starting SanchaarSetu full-stack..."
echo ""

# Build and start services
docker-compose up --build -d

echo ""
echo "✓ Services started:"
echo "  API: http://localhost:8000/health"
echo "  Postgres: localhost:5432 (user: postgres, pass: postgres)"
echo "  Redis: localhost:6379"
echo "  Kafka: localhost:9092"
echo ""

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 10

echo ""
echo "🧪 Running end-to-end tests..."
python3 test_e2e.py

echo ""
echo "📊 Inspecting database..."
echo ""
python3 inspect_db.py audit

echo ""
echo "✅ Demo complete! Next steps:"
echo "  1. View audit trail: python inspect_db.py audit"
echo "  2. View learned mappings: python inspect_db.py mappings"
echo "  3. View conflicts: python inspect_db.py conflicts"
echo "  4. Send custom webhook: curl -X POST http://localhost:8000/sws/webhook ..."
echo ""
echo "To stop services:"
echo "  docker-compose down"
