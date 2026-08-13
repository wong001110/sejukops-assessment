"use client";

import { Select } from "antd";
import { useState } from "react";

import { DEMO_IDENTITIES, getDemoIdentity } from "@/lib/auth/demo-identities";

export function RoleSwitcher({ currentIdentityId }: { currentIdentityId?: string }) {
  const current = getDemoIdentity(currentIdentityId);
  const [selectedIdentityId, setSelectedIdentityId] = useState(current?.id ?? "");

  const options = DEMO_IDENTITIES.map((identity) => ({
    value: identity.id,
    label: `${identity.name} — ${identity.label}`,
  }));

  return (
    <form className="role-switcher-form" action="/api/demo-session" method="post">
      <div className="role-switcher">
        <span className="role-switcher-label">Demo identity</span>
        <input type="hidden" name="identityId" value={selectedIdentityId} />
        <Select
          aria-label="Switch demo identity"
          value={selectedIdentityId || undefined}
          placeholder="Choose a role"
          options={options}
          onChange={setSelectedIdentityId}
          size="large"
          style={{ minWidth: 260 }}
        />
      </div>
      <button
        className="role-switcher-submit"
        type="submit"
        disabled={!selectedIdentityId}
        style={{ height: 40, minHeight: 40 }}
      >
        Open
      </button>
    </form>
  );
}
