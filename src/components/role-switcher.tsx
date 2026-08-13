"use client";

import { Select } from "antd";
import { useState } from "react";

import { DEMO_IDENTITIES, getDemoIdentity } from "@/lib/auth/demo-identities";

export function RoleSwitcher({ currentIdentityId, fluid = false }: { currentIdentityId?: string; fluid?: boolean }) {
  const current = getDemoIdentity(currentIdentityId);
  const [selectedIdentityId, setSelectedIdentityId] = useState(current?.id ?? "");

  const options = DEMO_IDENTITIES.map((identity) => ({
    value: identity.id,
    label: `${identity.name} — ${identity.label}`,
  }));

  return (
    <form
      className="role-switcher-form"
      action="/api/demo-session"
      method="post"
      style={{ display: "flex", flex: fluid ? "1 1 auto" : "0 1 340px", width: fluid ? "100%" : undefined, maxWidth: "100%", minWidth: 0, gap: 8 }}
    >
      <div className="role-switcher" style={{ display: "flex", flex: "1 1 auto", minWidth: 0 }}>
        <span className="role-switcher-label">Demo identity</span>
        <input type="hidden" name="identityId" value={selectedIdentityId} />
        <Select
          aria-label="Switch demo identity"
          value={selectedIdentityId || undefined}
          placeholder="Choose a role"
          options={options}
          onChange={setSelectedIdentityId}
          size="large"
          style={{ width: "100%", minWidth: 0 }}
        />
      </div>
      <button
        className="role-switcher-submit"
        type="submit"
        disabled={!selectedIdentityId}
        style={{ flex: "0 0 auto", height: 40, minHeight: 40 }}
      >
        Open
      </button>
    </form>
  );
}
