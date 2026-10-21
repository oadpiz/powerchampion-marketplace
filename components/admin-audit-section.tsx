"use client";

import { ResourceState, dateLabel, usePortalResource } from "./admin-resource";
import { useLocale } from "./locale-provider";

type AuditEvent = {
  id: string;
  action: string;
  actorEmail: string | null;
  targetId: string | null;
  createdAt: string | number;
};

export function AuditSection() {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<{ events: AuditEvent[] }>("/admin/audit");
  return (
    <ResourceState {...resource}>
      <section className="portal-panel">
        <div className="portal-actions">
          <h2>{zh ? "操作紀錄" : "Audit log"}</h2>
          <button
            type="button"
            className="portal-button-secondary"
            onClick={resource.refresh}
          >
            {zh ? "重新整理" : "Refresh"}
          </button>
        </div>
        <p className="portal-note">
          {zh
            ? "下列紀錄由伺服器提供，可核對操作人員、動作與目標。"
            : "Server-provided records identify the actor, action, and target of platform activity."}
        </p>
        {resource.data && resource.data.events.length > 0 ? (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <caption className="sr-only">
                {zh ? "平台操作紀錄" : "Platform activity records"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{zh ? "時間" : "Time"}</th>
                  <th scope="col">{zh ? "操作人員" : "Actor"}</th>
                  <th scope="col">{zh ? "動作" : "Action"}</th>
                  <th scope="col">{zh ? "目標 ID" : "Target ID"}</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.events.map((event) => (
                  <tr key={event.id}>
                    <td>{dateLabel(event.createdAt, zh)}</td>
                    <td>
                      {event.actorEmail || (zh ? "未提供" : "Not provided")}
                    </td>
                    <td>{event.action}</td>
                    <td>{event.targetId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="portal-empty">
            {zh ? "尚無操作紀錄。" : "No audit events yet."}
          </p>
        )}
      </section>
    </ResourceState>
  );
}

