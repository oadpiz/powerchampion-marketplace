import type { ReactNode } from "react";
import { AdminShellRoute } from "../../components/admin-shell-route";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShellRoute>{children}</AdminShellRoute>;
}
