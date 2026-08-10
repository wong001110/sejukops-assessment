import { DEMO_IDENTITIES, getDemoIdentity } from "@/lib/auth/demo-identities";

export function RoleSwitcher({ currentIdentityId }: { currentIdentityId?: string }) {
  const current = getDemoIdentity(currentIdentityId);

  return (
    <form className="role-switcher-form" action="/api/demo-session" method="post">
      <label className="role-switcher">
        <span className="role-switcher-label">Demo identity</span>
        <select
          aria-label="Switch demo identity"
          name="identityId"
          defaultValue={current?.id ?? ""}
          required
        >
          <option value="" disabled>
            Choose a role
          </option>
          {DEMO_IDENTITIES.map((identity) => (
            <option key={identity.id} value={identity.id}>
              {identity.name} — {identity.label}
            </option>
          ))}
        </select>
      </label>
      <button className="role-switcher-submit" type="submit">
        Open
      </button>
    </form>
  );
}
