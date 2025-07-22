#!/bin/sh
# K8s smoke test script to run inside the pod

echo "🏥 MCP Server Smoke Test"
echo "========================"

# Test 1: Health check
echo ""
echo "1. Health Check:"
wget -qO- http://localhost:4626/health && echo "✅ Health endpoint OK" || echo "❌ Health check failed"

# Test 2: Direct stdio test (tools/list)
echo ""
echo "2. Testing tools/list via stdio:"
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node /app/build/index.js | grep -q '"result"' && echo "✅ Tools list OK" || echo "❌ Tools list failed"

# Test 3: Create goal
echo ""
echo "3. Testing create_goal:"
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_goal","arguments":{"description":"Smoke test goal","userId":"smoke-test","sessionId":"test-session"}},"id":2}' | node /app/build/index.js | grep -q '"result"' && echo "✅ Goal created" || echo "❌ Goal creation failed"

# Test 4: Get current goal
echo ""
echo "4. Testing get_current_goal:"
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_current_goal","arguments":{"userId":"smoke-test","sessionId":"test-session"}},"id":3}' | node /app/build/index.js | grep -q 'Smoke test goal' && echo "✅ Goal retrieved" || echo "❌ Goal retrieval failed"

# Test 5: Add todo
echo ""
echo "5. Testing add_todo:"
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"add_todo","arguments":{"description":"Test todo item","userId":"smoke-test","sessionId":"test-session"}},"id":4}' | node /app/build/index.js | grep -q '"result"' && echo "✅ Todo added" || echo "❌ Todo addition failed"

# Test 6: List todos
echo ""
echo "6. Testing list_todos:"
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_todos","arguments":{"userId":"smoke-test","sessionId":"test-session"}},"id":5}' | node /app/build/index.js | grep -q 'Test todo item' && echo "✅ Todos listed" || echo "❌ Todo listing failed"

# Test 7: Complete todo
echo ""
echo "7. Testing complete_todo:"
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"complete_todo","arguments":{"index":0,"userId":"smoke-test","sessionId":"test-session"}},"id":6}' | node /app/build/index.js | grep -q '"result"' && echo "✅ Todo completed" || echo "❌ Todo completion failed"

# Test 8: Redis connection
echo ""
echo "8. Testing Redis connection:"
echo "PING" | nc -w 1 snapdragon.devops.svc.cluster.local 6379 | grep -q "PONG" && echo "✅ Redis connected" || echo "❌ Redis connection failed"

# Test 9: Session isolation
echo ""
echo "9. Testing session isolation:"
# Create goal for user1
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_goal","arguments":{"description":"User1 goal","userId":"user1","sessionId":"session1"}},"id":10}' | node /app/build/index.js > /dev/null
# Try to access user1's goal with user2
RESULT=$(echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_current_goal","arguments":{"userId":"user2","sessionId":"session1"}},"id":11}' | node /app/build/index.js)
if echo "$RESULT" | grep -q "User1 goal"; then
  echo "❌ Session isolation FAILED - user2 accessed user1's data!"
else
  echo "✅ Session isolation working"
fi

echo ""
echo "========================"
echo "🎉 Smoke test complete!"
