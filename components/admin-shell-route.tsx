"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminShell } from "./admin-shell";

export function AdminShellRoute({ children }: { children: ReactNode }) {
  return <AdminShell pathname={usePathname() ?? "/admin"}>{children}</AdminShell>;
}
