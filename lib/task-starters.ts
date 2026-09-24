/** Starters provide instructions only; source material always comes from the user. */
export const TASK_STARTERS = [
  {
    id: "analysis", mark: "01", format: "CSV + DOCX",
    en: {
      title: "Analyze a CSV", detail: "From raw rows to a decision brief.",
      goal: "Analyze the CSV I provide. Inspect its columns and missing values, calculate totals and useful grouped comparisons with the CSV tool, and explain the main findings. Create a summary CSV and a Word report with findings, limitations and recommended next steps. Use only supplied data; if it is missing or insufficient, explain what is needed instead of inventing results.",
      source: "Add your CSV below. Name the columns or metrics that matter to your decision.",
    },
    zh: {
      title: "分析 CSV 資料", detail: "把原始資料整理成決策報告。",
      goal: "分析我提供的 CSV，先檢查欄位與缺漏，再使用 CSV 工具計算合計與有意義的分組比較，說明主要發現。製作摘要 CSV 與 Word 報告，包含發現、限制與建議下一步。僅使用提供的資料；如果資料缺漏或不足，說明需要補充的內容，不要編造結果。",
      source: "在下方加入你的 CSV，並補充這次決策關心的欄位或指標。",
    },
  },
  {
    id: "comparison", mark: "02", format: "DOCX",
    en: {
      title: "Compare proposals", detail: "Make the trade-offs easy to review.",
      goal: "Compare the proposals I supply. Build a comparison of scope, costs, constraints and unanswered questions, citing the source name for each material claim. If I include a public HTTPS URL, request approval before reading it. Create a Word decision brief with a comparison table and next steps. Mark missing facts as unknown; do not invent prices or evidence.",
      source: "Paste each proposal as a named reference, or add TXT / Markdown files. Include any public source URLs in the goal.",
    },
    zh: {
      title: "比較提案方案", detail: "讓成本、取捨與疑問一目了然。",
      goal: "比較我提供的提案，整理範圍、成本、限制與待釐清問題，每個重要結論都標註來源資料名稱。如果我提供公開 HTTPS 網址，先取得我的核准再讀取。製作 Word 決策報告，包含比較表與建議下一步。缺少的事實標為未知，不要編造價格或證據。",
      source: "將各提案貼成具名參考資料，或加入 TXT / Markdown 檔案；公開來源網址可寫進任務目標。",
    },
  },
  {
    id: "handover", mark: "03", format: "MD + CSV",
    en: {
      title: "Turn notes into action", detail: "Leave with an organized handover.",
      goal: "Turn the meeting notes I provide into a project handover. Separate decisions, open questions, risks and action items. Create a Markdown brief and an action-item CSV with task, owner, deadline and source columns. Use only owners and dates that appear in the notes; label missing values as unassigned or not specified. Do not send messages or create tasks in external systems.",
      source: "Add meeting notes or a project brief below. The agent will create files you can review and share.",
    },
    zh: {
      title: "整理會議與交接", detail: "從零散紀錄到可交付的行動清單。",
      goal: "把我提供的會議紀錄整理成專案交接，區分已定事項、待確認問題、風險與行動項目。製作 Markdown 摘要，以及包含任務、負責人、期限與來源欄位的 CSV。負責人與日期只能使用紀錄中明確提供的內容，缺少的值標為尚未指派或未註明。不要發送訊息，也不要在外部系統建立任務。",
      source: "在下方加入會議紀錄或專案需求，智能體會製作可供檢閱與分享的檔案。",
    },
  },
] as const;

export function taskEntry(search: string) {
  const params = new URLSearchParams(search);
  const agent = params.get("agent");
  const validAgent = agent && /^[a-f0-9]{32}$/.test(agent) ? agent : null;
  const starterId = TASK_STARTERS.find((starter) => starter.id === params.get("starter"))?.id ?? null;
  const safeParams = new URLSearchParams();
  if (validAgent) safeParams.set("agent", validAgent);
  if (starterId) safeParams.set("starter", starterId);
  const query = safeParams.toString();
  return { agent, starterId, returnPath: query ? `/tasks?${query}` : "/tasks" };
}
