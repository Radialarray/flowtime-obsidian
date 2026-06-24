<%*
/**

* Daily Note Template
* Shows task queries. Day Planner reads timed tasks from project notes automatically.
 */
const title = tp.file.title;
const dateMatch = title.match(/\d{4}-\d{2}-\d{2}/);
const baseDate = dateMatch ? moment(dateMatch[0], "YYYY-MM-DD") : moment();

const d = {
  today: baseDate.format("YYYY-MM-DD"),
  human: baseDate.format("dddd, MMMM Do, YYYY"),
  yesterday: moment(baseDate).subtract(1, "day").format("YYYY-MM-DD"),
  tomorrow: moment(baseDate).add(1, "day").format("YYYY-MM-DD"),
  endOfWeek: moment(baseDate).endOf("isoWeek").format("YYYY-MM-DD"),
  isoWeek: baseDate.format("GGGG-[W]WW")
};

function tasksCallout(title, type, lines, collapsed) {
  const sym = collapsed ? "+" : "-";
  return [
    `> [!${type}]${sym} ${title}`,
    ">",
    "> ```tasks",
    ...lines.map(l => `> ${l}`),
    ">```"
  ].join("\n");
}

const doneToday = tasksCallout("Completed Today", "success", [
  `done on ${d.today}`,
  "sort by done"
], false);

const content = `<< [[../Daily/${d.yesterday}|← yesterday]] || [[../Daily/${d.tomorrow}|tomorrow →]]

# ${d.human}

## 🔄 Carry Over

> [!danger] Unfinished tasks — click date to assign to today or backlog

\`\`\`task-planner-overdue
\`\`\`

## 🎯 Today

> [!tip] Set times for today's tasks — edits save to source files

\`\`\`task-planner
\`\`\`

## ⚠️ Due This Week

> [!warning] Tasks due this week — click date to schedule

\`\`\`task-planner-dueweek
\`\`\`

## Quick Tasks

> [!note]+ Ad-hoc
>
> * [ ]

# Day planner

<!-- Tasks with times saved above now appear on the Day Planner timeline. -->
<!-- This section is for ad-hoc tasks that don't have a source note. -->

* [ ] 09:00

## Notes

---

${doneToday}

Week: #week/${d.isoWeek}
Created: ${d.today}
`;

tR += content;
_%>
