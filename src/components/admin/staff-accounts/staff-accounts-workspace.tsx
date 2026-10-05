"use client";

import { Alert, Button, Card, Empty, Flex, Form, Input, Modal, Result, Select, Skeleton, Space, Switch, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { STAFF_ROLES, staffAccountInputSchema, type StaffAccountInput, type StaffAccountList, type StaffAccountSummary, type StaffCredential, type StaffRole } from "@/domain/staff/contracts";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { StaffCredentialsModal } from "./staff-credentials-modal";
import { StaffImportPanel } from "./staff-import-panel";
import { staffApi } from "./staff-api";

type Values = { name: string; email: string; role: StaffRole; branchCode?: string | null; active: boolean };
const roleOptions = STAFF_ROLES.map((role) => ({ value: role, label: role === "ADMIN" ? "Admin" : role === "MANAGER" ? "Manager" : "Technician" }));
const failure = (cause: unknown) => cause instanceof Error ? cause.message : "The staff request failed. Please retry.";

/** A new workspace mounts a fresh screen, including all temporary credential state. */
export function StaffAccountsWorkspace({ workspaceId }: { workspaceId: string }) {
  return <StaffWorkspace key={workspaceId} workspaceId={workspaceId} />;
}

function StaffWorkspace({ workspaceId }: { workspaceId: string }) {
  const [snapshot, setSnapshot] = useState<StaffAccountList>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [editor, setEditor] = useState<"create" | StaffAccountSummary>();
  const [reset, setReset] = useState<StaffAccountSummary>();
  const [editorError, setEditorError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [disableConfirmed, setDisableConfirmed] = useState(false);
  const [credentials, setCredentials] = useState<StaffCredential[]>([]);
  const [form] = Form.useForm<Values>();
  const role = Form.useWatch("role", form);
  const active = Form.useWatch("active", form);
  const pending = useRef(false);
  const requestKey = useRef<{ input: string; key: string }>();
  const mounted = useRef(true);
  const loads = useLatestRequest();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (quiet = false) => {
    const request = loads.begin();
    if (!quiet) setLoading(true);
    setLoadError(undefined);
    try { const next = await staffApi.list(workspaceId, request.signal); if (request.isCurrent()) setSnapshot(next); }
    catch (cause) { if (request.isCurrent()) setLoadError(failure(cause)); }
    finally { if (request.isCurrent()) { setLoading(false); request.finish(); } }
  }, [loads, workspaceId]);
  useEffect(() => { void load(); }, [load]);

  const closeEditor = () => { if (pending.current) return; setEditor(undefined); setReset(undefined); setEditorError(undefined); setDisableConfirmed(false); requestKey.current = undefined; form.resetFields(); };
  const openEditor = (account?: StaffAccountSummary) => {
    setEditor(account ?? "create"); setEditorError(undefined); setDisableConfirmed(false); requestKey.current = undefined;
    form.resetFields(); form.setFieldsValue(account ? { ...account } : { name: "", email: "", role: "ADMIN", active: true, branchCode: null });
  };
  const keyFor = (input: string) => { if (requestKey.current?.input !== input) requestKey.current = { input, key: crypto.randomUUID() }; return requestKey.current.key; };
  const adopt = (account: StaffAccountSummary) => {
    // A pre-mutation refresh must not replace the new account/revision afterward.
    loads.cancel();
    setSnapshot((current) => current && ({ ...current, accounts: [...current.accounts.filter((item) => item.profileId !== account.profileId), account] }));
  };
  const save = async (confirmed = false) => {
    if (pending.current || !editor) return;
    pending.current = true; setBusy(true); setEditorError(undefined);
    try {
      const values = await form.validateFields();
      if (!mounted.current) return;
      const branchCode = values.role === "TECHNICIAN" ? values.branchCode ?? null : null;
      const parsed = staffAccountInputSchema.safeParse({ name: values.name, email: values.email, role: values.role, branchCode });
      if (!parsed.success) { form.setFields(parsed.error.issues.map((issue) => ({ name: issue.path[0] as keyof Values, errors: [issue.message] }))); return; }
      if (editor !== "create" && editor.active && !values.active && !confirmed) { setDisableConfirmed(true); return; }
      if (editor === "create") {
        const input: StaffAccountInput = parsed.data;
        const result = await staffApi.create(workspaceId, keyFor(JSON.stringify(input)), input);
        if (!mounted.current) return;
        adopt(result.account);
        if (result.credential) setCredentials([result.credential]);
        setFeedback(result.credential ? "Staff account created." : "Staff account is available. Its temporary password is no longer available; use Reset temporary password to provide login credentials.");
      } else {
        const result = await staffApi.update(workspaceId, editor, { role: values.role, branchCode, active: values.active });
        if (!mounted.current) return;
        adopt(result.account); setFeedback("Staff account updated. Previous sessions must sign in again.");
      }
      setEditor(undefined); setDisableConfirmed(false); requestKey.current = undefined; form.resetFields();
    } catch (cause) { if (mounted.current && cause instanceof Error) setEditorError(failure(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const resetPassword = async () => {
    if (pending.current || !reset) return;
    pending.current = true; setBusy(true); setEditorError(undefined);
    try {
      const result = await staffApi.resetPassword(workspaceId, reset, keyFor(`reset:${reset.profileId}:${reset.authRevision}`));
      if (!mounted.current) return;
      adopt(result.account); if (result.credential) setCredentials([result.credential]);
      setFeedback(result.credential ? "Temporary password reset." : "This reset already completed. Its temporary password is no longer available; close this dialog and start a new reset if needed.");
      setReset(undefined); requestKey.current = undefined;
    } catch (cause) { if (mounted.current) setEditorError(failure(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };

  if (loading) return <div className="product-page" role="status" aria-label="Loading staff accounts"><Skeleton active /></div>;
  if (!snapshot) return <Result status="error" title="Staff accounts could not be loaded" subTitle={loadError} extra={<Button onClick={() => void load()}>Retry</Button>} />;
  return <Space direction="vertical" size={20} className="product-page" style={{ width: "100%", minWidth: 0 }}>
    <Flex justify="space-between" align="center" gap={12} wrap><Typography.Title level={2}>Staff accounts</Typography.Title><Space wrap><Button onClick={() => void load(true)}>Refresh</Button><Button type="primary" onClick={() => openEditor()}>Create staff account</Button></Space></Flex>
    <Typography.Paragraph>Manage permanent employee access to this workspace. Temporary passwords require a change at the next sign-in.</Typography.Paragraph>
    {feedback ? <Alert type="success" message={feedback} closable onClose={() => setFeedback(undefined)} /> : null}
    {loadError ? <Alert type="error" message={loadError} action={<Button onClick={() => void load(true)}>Retry refresh</Button>} /> : null}
    <Card title="Employees" styles={{ body: { padding: 12 } }}>
      {snapshot.accounts.length ? <Table rowKey="profileId" pagination={{ pageSize: 10 }} scroll={{ x: 850 }} dataSource={[...snapshot.accounts]} columns={[
        { title: "Employee", key: "employee", render: (_, account: StaffAccountSummary) => <div style={{ overflowWrap: "anywhere" }}><strong>{account.name}</strong><br />{account.email}</div> },
        { title: "Role", dataIndex: "role" }, { title: "Branch", key: "branch", render: (_, account) => snapshot.branches.find((branch) => branch.code === account.branchCode)?.name ?? account.branchCode ?? "—" },
        { title: "Access", key: "active", render: (_, account) => <Tag color={account.active ? "green" : undefined}>{account.active ? "Active" : "Disabled"}</Tag> },
        { title: "Onboarding", key: "onboarding", render: (_, account) => account.passwordChangeRequired ? "Password change required" : "Ready" },
        { title: "Actions", key: "actions", render: (_, account) => <Space wrap><Button aria-label={`Edit ${account.name}`} onClick={() => openEditor(account)}>Edit</Button><Button aria-label={`Reset temporary password for ${account.name}`} onClick={() => { setReset(account); setEditorError(undefined); requestKey.current = undefined; }}>Reset temporary password</Button></Space> },
      ]} /> : <Empty description="No staff accounts yet" />}
    </Card>
    <StaffImportPanel workspaceId={workspaceId} onChanged={() => void load(true)} />
    <Modal open={Boolean(editor)} title={editor === "create" ? "Create staff account" : `Edit ${editor?.name ?? "employee"}`} destroyOnHidden maskClosable={false} closable={!busy} keyboard={!busy} onCancel={closeEditor} footer={<Space><Button disabled={busy} onClick={closeEditor}>Cancel</Button><Button type="primary" aria-label={editor === "create" ? "Create account" : "Save changes"} aria-busy={busy} disabled={busy} loading={busy} onClick={() => void save()}>{editor === "create" ? "Create account" : "Save changes"}</Button></Space>}>
      {editorError ? <Alert type="error" message={editorError} /> : null}
      <Form form={form} layout="vertical" preserve={false} disabled={busy} onValuesChange={() => setDisableConfirmed(false)}>
        <Form.Item name="name" label="Employee name" rules={[{ required: true, whitespace: true }, { max: 100 }]}><Input disabled={editor !== "create" || busy} /></Form.Item>
        <Form.Item name="email" label="Employee email" rules={[{ required: true }, { type: "email" }, { max: 254 }]}><Input type="email" disabled={editor !== "create" || busy} /></Form.Item>
        <Form.Item name="role" label="Business role" rules={[{ required: true }]}><Select options={roleOptions} onChange={() => form.resetFields(["branchCode"])} /></Form.Item>
        {role === "TECHNICIAN" ? <Form.Item name="branchCode" label="Technician branch" rules={[{ required: true, message: "Choose a branch for this Technician." }]}><Select options={snapshot.branches.map((branch) => ({ value: branch.code, label: `${branch.name} (${branch.code})` }))} /></Form.Item> : null}
        {editor !== "create" ? <Form.Item name="active" label="Account active" valuePropName="checked"><Switch aria-label="Account active" /></Form.Item> : null}
      </Form>
      {editor !== "create" && editor?.active && active === false ? <Alert type="warning" message="Disabling this employee revokes access and requires a new sign-in after reactivation." /> : null}
    </Modal>
    <Modal open={disableConfirmed} title="Disable employee access?" onCancel={() => setDisableConfirmed(false)} maskClosable={false} closable={!busy} keyboard={!busy} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} okButtonProps={{ danger: true, disabled: busy, "aria-label": "Confirm disable", "aria-busy": busy }} okText="Confirm disable" onOk={() => void save(true)}><p>This employee will lose workspace access. Existing sessions will be invalidated.</p></Modal>
    <Modal open={Boolean(reset)} title={`Reset temporary password for ${reset?.name ?? "employee"}?`} maskClosable={false} closable={!busy} keyboard={!busy} onCancel={closeEditor} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} okButtonProps={{ disabled: busy, "aria-label": "Reset password", "aria-busy": busy }} okText="Reset password" onOk={() => void resetPassword()}>
      <Typography.Paragraph>The employee must change the temporary password at the next sign-in. All previous sessions become invalid. Share the new password privately; it is displayed only once.</Typography.Paragraph>
      {editorError ? <Alert type="error" message={editorError} /> : null}
    </Modal>
    <StaffCredentialsModal credentials={credentials} onClose={() => setCredentials([])} />
  </Space>;
}


