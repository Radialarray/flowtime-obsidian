#!/bin/bash
# Flowtime Plugin - CLI Test Suite (v0.3.0)
# Requires: Obsidian running, obsidian CLI installed
# Run: bash test.sh

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Flowtime Plugin Tests (v0.3.0) ==="
echo ""

# Test 1: Plugin load
echo "--- Plugin Load ---"
obsidian eval 'app.plugins.plugins["flowtime"] ? "PASS: loaded" : "FAIL: not loaded"'
obsidian eval 'app.plugins.plugins["flowtime"]?._loaded ? "PASS: _loaded" : "FAIL: _loaded"'

# Test 2: Commands — count should be 6+ (add-task, add-task-inline, insert-daily, insert-weekly, new-project, onboard)
echo "--- Commands ---"
obsidian eval 'var c=Object.keys(app.commands.commands).filter(function(k){return k.startsWith("flowtime:")}); c.length >= 5 ? "PASS: "+c.length+" commands" : "FAIL: "+c.length+" cmd(s)"'
obsidian eval 'var c=Object.keys(app.commands.commands); c.indexOf("flowtime:add-task")>-1 ? "PASS: add-task" : "FAIL: add-task missing"'
obsidian eval 'var c=Object.keys(app.commands.commands); c.indexOf("flowtime:new-project")>-1 ? "PASS: new-project" : "FAIL: new-project missing"'

# Test 3: Settings — check new v0.3.0 settings
echo "--- Settings ---"
obsidian eval 'var s=app.plugins.plugins["flowtime"].settings; s.buckets && s.buckets.length >= 3 ? "PASS: buckets exist ("+s.buckets.length+")" : "FAIL: buckets"'
obsidian eval 'var s=app.plugins.plugins["flowtime"].settings; s.bucketPrefix==="budget/" ? "PASS: bucketPrefix" : "FAIL: bucketPrefix="+s.bucketPrefix'
obsidian eval 'var s=app.plugins.plugins["flowtime"].settings; s.dailyCap===12 ? "PASS: dailyCap=12" : "FAIL: dailyCap="+s.dailyCap'
obsidian eval 'var s=app.plugins.plugins["flowtime"].settings; s.timerSound===true ? "PASS: timerSound" : "FAIL: timerSound="+s.timerSound'

# Test 4: Engines
echo "--- Engines ---"
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.projectEngine ? "PASS: projectEngine" : "FAIL: projectEngine"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.templateEngine ? "PASS: templateEngine" : "FAIL: templateEngine"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.statusTimer ? "PASS: statusTimer" : "FAIL: statusTimer"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.sessionStore ? "PASS: sessionStore" : "FAIL: sessionStore"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; typeof p.notify==="function" ? "PASS: notify()" : "FAIL: notify()"'

# Test 5: Date parser
echo "--- Date Parser ---"
obsidian eval 'var dp=require("'$REPO_DIR'/src/date-parser.js"); dp.parseDate("today") ? "PASS: today" : "FAIL: today"'
obsidian eval 'var dp=require("'$REPO_DIR'/src/date-parser.js"); dp.parseDate("garbage")===null ? "PASS: invalid=null" : "FAIL: invalid"'

# Test 6: Task parser — new v0.3.0 syntax
echo "--- Task Parser ---"
obsidian eval 'var tp=require("'$REPO_DIR'/src/task-parser.js"); var r=tp.parseTaskLine("- [ ] Write spec @bucket:deep-work",{path:"t.md"},0); r&&r.bucket==="deep-work" ? "PASS: bucket parsing" : "FAIL: bucket parsing"'
obsidian eval 'var tp=require("'$REPO_DIR'/src/task-parser.js"); var r=tp.parseTaskLine("- [ ] Task @1.5h",{path:"t.md"},0); r&&r.durationMinutes===90 ? "PASS: duration parsing 1.5h=90m" : "FAIL: duration="+(r?r.durationMinutes:"null")'
obsidian eval 'var tp=require("'$REPO_DIR'/src/task-parser.js"); var r=tp.parseTaskLine("- [ ] Task @30m",{path:"t.md"},0); r&&r.durationMinutes===30 ? "PASS: duration parsing 30m" : "FAIL: duration="+(r?r.durationMinutes:"null")'

# Test 7: Filter engine
echo "--- Filter Engine ---"
obsidian eval 'var fe=require("'$REPO_DIR'/src/filter-engine.js"); fe.evaluateFilter({field:"bucket",op:"eq",value:"deep-work"},{bucket:"deep-work"})===true ? "PASS: filter eq" : "FAIL: filter eq"'
obsidian eval 'var fe=require("'$REPO_DIR'/src/filter-engine.js"); !fe.evaluateFilter({field:"bucket",op:"eq",value:"other"},{bucket:"deep-work"}) ? "PASS: filter neq" : "FAIL: filter neq"'
obsidian eval 'var fe=require("'$REPO_DIR'/src/filter-engine.js"); fe.evaluateFilter({op:"and",filters:[{field:"bucket",op:"eq",value:"x"},{field:"bucket",op:"eq",value:"y"}]},{bucket:"x"})===false ? "PASS: filter and false" : "FAIL: filter and"'

# Test 8: Budget state
echo "--- Budget State ---"
obsidian eval 'var bs=require("'$REPO_DIR'/src/budget-state.js"); bs.getBudgetState(0,10).state==="normal" ? "PASS: budget normal" : "FAIL: budget normal"'
obsidian eval 'var bs=require("'$REPO_DIR'/src/budget-state.js"); bs.getBudgetState(8,10).state==="warning" ? "PASS: budget warning" : "FAIL: budget warning"'
obsidian eval 'var bs=require("'$REPO_DIR'/src/budget-state.js"); bs.getBudgetState(10,10).state==="over" ? "PASS: budget over" : "FAIL: budget over"'

echo ""
echo "=== Done ==="
