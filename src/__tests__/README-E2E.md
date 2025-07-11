# E2E Integration Test for Cintra-Taskmaster

## 🔐 SAFETY CRITICAL

This test is designed with **multiple safety layers** to ensure it **NEVER affects real work tickets** on your JAR board.

## Safety Features

### 1. Unique Identification
- **Test ID Pattern**: `E2E-TEST-{timestamp}` in all ticket titles
- **Single Verification**: Only tickets with exact test pattern in title are affected

### 2. Comprehensive Tracking
- **Ticket Registry**: Every created ticket is immediately registered
- **Dependency Order**: Cleanup respects parent-child relationships
- **Emergency Cleanup**: Runs even if test fails

### 3. Pre-Deletion Safety Checks
```typescript
// Before ANY ticket deletion, the system verifies:
const hasTestTitle = taskData.title.includes(TEST_IDENTIFIER);
const isSafeToDelete = hasTestTitle;
```

## Running the Test

### Prerequisites
1. Ensure `.env` file has valid Jira credentials
2. Jira API access working
3. No other integration tests running

### Commands
```bash
# Run E2E test only
npm run test:e2e

# Run with verbose output
npm run test:e2e -- --verbose

# Run unit tests (excludes E2E)
npm run test:unit
```

### Test Timeout
- **Default**: 5 minutes (300,000ms)
- **Reason**: Creates epic → task → subtasks → tests all tools → cleanup

## What the Test Does

### Phase 1: Setup & Epic Creation
1. Creates test epic with unique identifier
2. Verifies epic creation and metadata

### Phase 2: Task Creation & Expansion
3. Creates child task linked to epic
4. Verifies parent-child relationship
5. Expands task into 3 subtasks

### Phase 3: Task Management
6. Finds next available task
7. Updates task statuses (In Progress, Done)
8. Adds comments to tasks
9. Updates task content with LLM

### Phase 4: Advanced Operations
10. Tests attachment handling
11. Tests multiple status updates
12. Verifies error handling

### Phase 5: Complete Cleanup
13. Collects all test tickets
14. Verifies each ticket is safe to delete
15. Removes all test tickets in correct order
16. Validates complete cleanup

## Tools Tested

✅ **add_jira_issue** - Epic and task creation  
✅ **get_jira_task** - Ticket retrieval and verification  
✅ **expand_jira_task** - Task expansion into subtasks  
✅ **next_jira_task** - Next task identification  
✅ **set_jira_task_status** - Status transitions  
✅ **add_jira_comment** - Comment addition  
✅ **update_jira_task** - Content updates with LLM  
✅ **get_jira_attachment** - Attachment handling  
✅ **remove_jira_task** - Complete cleanup  

## Safety Guarantees

### ✅ What the Test WILL Do
- Create tickets with unique identifiers
- Test all functionality thoroughly
- Clean up completely after itself
- Verify no test tickets remain

### ❌ What the Test WILL NEVER Do
- Touch any existing work tickets
- Modify tickets without safety verification
- Leave test tickets on the board
- Affect real project data

## Error Handling

### If Test Fails
- **Emergency Cleanup**: Runs automatically in `afterAll()`
- **Safety Checks**: Each ticket verified before deletion
- **Logging**: Full trace of all operations
- **Registry Reset**: Ensures no stale references

### If Cleanup Fails
- **Manual Cleanup**: Look for tickets with pattern `E2E-TEST-{timestamp}`
- **Unique Timestamps**: Each test run has unique identifier

## Example Output

```
🚀 E2E Test Suite Starting with ID: E2E-TEST-1703123456789
🔐 Safety Mode: Only tickets with "E2E-TEST-1703123456789" pattern will be affected

📋 PHASE 1: Setup & Epic Creation
1️⃣ Creating test epic...
✅ Created test epic: JAR-1234

📋 PHASE 2: Task Creation & Expansion
3️⃣ Creating child task linked to epic...
✅ Created child task: JAR-1235
5️⃣ Expanding task into subtasks...
✅ Task expanded into 3 subtasks: JAR-1236, JAR-1237, JAR-1238

... (all phases complete) ...

🧹 PHASE 5: Cleanup & Validation
🗑️ Removed subtask: JAR-1236
🗑️ Removed subtask: JAR-1237
🗑️ Removed subtask: JAR-1238
🗑️ Removed main task: JAR-1235
🗑️ Removed epic: JAR-1234

🎉 E2E Test Suite COMPLETED Successfully!
✅ All 9 tools tested
✅ Epic → Task → Subtask hierarchy validated
✅ Complete cleanup performed
✅ No real tickets affected
```

## Monitoring

### During Test
- Watch console output for safety confirmations
- Each ticket creation shows unique identifier
- All deletions show safety verification

### After Test
- Verify no tickets with test pattern remain
- Check Jira board for any orphaned test tickets
- Confirm test completed successfully

## Support

If you encounter any issues:
1. Check that all test tickets were removed
2. Look for tickets with pattern `E2E-TEST-*`
3. Verify environment variables are correct
4. Check Jira API connectivity

**Remember**: This test is designed to be completely safe for your production JAR board! 