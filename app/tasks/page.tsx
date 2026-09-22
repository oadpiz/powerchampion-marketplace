import type { Metadata } from "next";
import { TaskConsole } from "../../components/task-console";

export const metadata: Metadata = {
  title: "Agent Tasks | Power Champion",
  description: "Your private workspace for persistent agent tasks and deliverables.",
  robots: { index: false, follow: false },
};

export default function TasksPage() { return <TaskConsole />; }
