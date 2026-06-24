#!/bin/bash
# Flowtime Plugin - CLI Test Suite
# Requires: Obsidian running, obsidian CLI installed
# Run: bash test.sh

echo "=== Flowtime Plugin Tests ==="
echo ""

# Test 1: Plugin load
echo "--- Plugin Load ---"
obsidian eval 'app.plugins.plugins["flowtime"] ? "PASS: loaded" : "FAIL: not loaded"'
obsidian eval 'app.plugins.plugins["flowtime"]?._loaded ? "PASS: _loaded" : "FAIL: _loaded"'

# Test 2: Commands
echo "--- Commands ---"
obsidian eval 'var c=Object.keys(app.commands.commands).filter(function(k){return k.startsWith("flowtime:")}); c.length===4 ? "PASS: 4 commands" : "FAIL: "+c.length+" cmd(s)"'
obsidian eval 'var c=Object.keys(app.commands.commands); c.indexOf("flowtime:add-task")>-1 ? "PASS: add-task" : "FAIL: add-task missing"'
obsidian eval 'var c=Object.keys(app.commands.commands); c.indexOf("flowtime:new-project")>-1 ? "PASS: new-project" : "FAIL: new-project missing"'
obsidian eval 'var c=Object.keys(app.commands.commands); c.indexOf("flowtime:insert-daily-dashboard")>-1 ? "PASS: insert-daily" : "FAIL: insert-daily missing"'
obsidian eval 'var c=Object.keys(app.commands.commands); c.indexOf("flowtime:insert-weekly-dashboard")>-1 ? "PASS: insert-weekly" : "FAIL: insert-weekly missing"'

# Test 3: Settings defaults
echo "--- Settings ---"
obsidian eval 'var s=app.plugins.plugins["flowtime"].settings; s.tagPrefix==="project/" ? "PASS: tagPrefix" : "FAIL: tagPrefix="+s.tagPrefix'
obsidian eval 'var s=app.plugins.plugins["flowtime"].settings; s.timerSound===true ? "PASS: timerSound" : "FAIL: timerSound='+s.timerSound'
obsidian eval 'var s=app.plugins.plugins["flowtime"].settings; s.quietMode===false ? "PASS: quietMode" : "FAIL: quietMode='+s.quietMode'
obsidian eval 'var s=app.plugins.plugins["flowtime"].settings; s.noticeDuration===4000 ? "PASS: noticeDuration" : "FAIL: noticeDuration='+s.noticeDuration'
obsidian eval 'var s=app.plugins.plugins["flowtime"].settings; s.statusBarTimer===true ? "PASS: statusBarTimer" : "FAIL: statusBarTimer='+s.statusBarTimer'

# Test 4: Engines
echo "--- Engines ---"
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.projectEngine ? "PASS: projectEngine" : "FAIL: projectEngine"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.templateEngine ? "PASS: templateEngine" : "FAIL: templateEngine"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.statusBarItem ? "PASS: statusBarItem" : "FAIL: statusBarItem"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; typeof p.notify==="function" ? "PASS: notify()" : "FAIL: notify()"'

# Test 5: Date parser
echo "--- Date Parser ---"
obsidian eval 'var dp=require("/path/to/repo/src/date-parser.js"); dp.parseDate("today") ? "PASS: today" : "FAIL: today"'
obsidian eval 'var dp=require("/path/to/repo/src/date-parser.js"); dp.parseDate("tomorrow") ? "PASS: tomorrow" : "FAIL: tomorrow"'
obsidian eval 'var dp=require("/path/to/repo/src/date-parser.js"); dp.parseDate("garbage")===null ? "PASS: invalid=null" : "FAIL: invalid"'
obsidian eval 'var dp=require("/path/to/repo/src/date-parser.js"); dp.parseDate("2026-12-01")==="2026-12-01" ? "PASS: exact" : "FAIL: exact"'

# Test 6: Project tag resolution
echo "--- Project Tags ---"
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.projectEngine.resolveFromTag("fix #project/web","project/")==="web" ? "PASS: tag" : "FAIL: tag"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.projectEngine.resolveFromTag("no tag","project/")===null ? "PASS: no tag" : "FAIL: no tag"'

# Test 7: Template engine
echo "--- Template Engine ---"
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.templateEngine.render("Hi {{X}}",{X:"W"})==="Hi W" ? "PASS: render" : "FAIL: render"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.templateEngine.getDailyVars().DATE ? "PASS: daily vars" : "FAIL: daily vars"'
obsidian eval 'var p=app.plugins.plugins["flowtime"]; p.templateEngine.getWeeklyVars().WEEK_START ? "PASS: weekly vars" : "FAIL: weekly vars"'

echo ""
echo "=== Done ==="
