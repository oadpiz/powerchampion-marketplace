/** Sections served by the admin catch-all route (`/admin/<section>`). */
export const ADMIN_SECTIONS = [
  "overview",
  "customers",
  "keys",
  "redeem",
  "usage",
  "gateway",
  "personas",
  "allocation",
  "engineers",
  "credits",
  "audit",
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export function isAdminSection(value: string): value is AdminSection {
  return (ADMIN_SECTIONS as readonly string[]).includes(value);
}
