-- Current fictional Demo records are owned by the reviewed, Demo-only helper.
-- Before the three fixed server-side Demo principals exist this returns false;
-- the principal bootstrap invokes the same helper after provisioning.
-- Existing shared Demo edits are preserved by private.demo_seed().
select private.demo_seed();
