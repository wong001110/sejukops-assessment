"use client";

import { Alert, Button, Card, Flex, Modal, Space, Table, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { STAFF_IMPORT_MAX_BYTES, type StaffCredential, type StaffImportDraft, type StaffRowResult } from "@/domain/staff/contracts";
import { useLatestRequest } from "@/lib/ui/use-latest-request";
import { StaffCredentialsModal } from "./staff-credentials-modal";
import { staffApi } from "./staff-api";

export function StaffImportPanel({ workspaceId, onChanged }: { workspaceId: string; onChanged: () => void }) {
  const [draft, setDraft] = useState<StaffImportDraft>();
  const [error, setError] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [complete, setComplete] = useState(false);
  const [results, setResults] = useState<StaffRowResult[]>([]);
  const [credentials, setCredentials] = useState<StaffCredential[]>([]);
  const pending = useRef(false);
  const stop = useRef(false);
  const mounted = useRef(true);
  const previews = useLatestRequest();
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; }; }, []);

  const clear = () => { if (pending.current) return; previews.cancel(); setPreviewing(false); setDraft(undefined); setResults([]); setError(undefined); setComplete(false); setStarted(false); setStopped(false); setCredentials([]); if (fileInput.current) fileInput.current.value = ""; };
  const preview = async (file?: File) => {
    if (!file || pending.current) return;
    previews.cancel(); setError(undefined); setDraft(undefined); setResults([]); setStarted(false); setStopped(false); setComplete(false);
    if (!file.name.toLowerCase().endsWith(".xlsx")) { setError("Choose an .xlsx staff workbook."); return; }
    if (file.size > STAFF_IMPORT_MAX_BYTES) { setError("The workbook must be 1 MB or smaller."); return; }
    const request = previews.begin(); setPreviewing(true);
    try { const next = await staffApi.preview(workspaceId, file, request.signal); if (request.isCurrent()) setDraft(next); }
    catch (cause) { if (request.isCurrent()) setError(cause instanceof Error ? cause.message : "The workbook could not be validated. Please retry."); }
    finally { if (request.isCurrent()) { setPreviewing(false); request.finish(); } }
  };
  const confirm = async (retryFailed = false) => {
    if (pending.current || !draft || draft.invalidCount > 0 || !draft.validCount) return;
    pending.current = true; stop.current = false; setRunning(true); setStarted(true); setStopped(false); setError(undefined);
    try {
      let retry = retryFailed;
      while (!stop.current && mounted.current) {
        const next = await staffApi.confirm(workspaceId, draft.importId, retry);
        retry = false;
        if (!mounted.current) return;
        // Credentials stay in a temporary modal state, never in the results table.
        setCredentials((current) => {
          const byEmail = new Map(current.map((credential) => [credential.email, credential]));
          for (const result of next.results) if (result.credential) byEmail.set(result.credential.email, result.credential);
          return [...byEmail.values()];
        });
        setResults((current) => {
          const byRow = new Map(current.map((result) => [result.row, result]));
          for (const { row, status, profileId, error: rowError } of next.results) byRow.set(row, { row, status, profileId, error: rowError });
          return [...byRow.values()].sort((a, b) => a.row - b.row);
        });
        setComplete(next.complete);
        onChanged();
        if (next.complete) break;
      }
      if (mounted.current && stop.current) setStopped(true);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Import paused after a request failed. Retry to resume safely."); }
    finally { pending.current = false; if (mounted.current) setRunning(false); }
  };
  const failed = results.filter((result) => result.status === "FAILED").length;
  return <Card title="Import employees from Excel">
    <Typography.Paragraph>Use the template for up to 100 new accounts. Review every row, then explicitly confirm. Existing accounts are never overwritten. Passwords are generated separately and never included in the workbook.</Typography.Paragraph>
    <Flex gap={12} wrap align="center"><Button href={`/api/platform/staff/import/template?workspaceId=${encodeURIComponent(workspaceId)}`}>Download .xlsx template</Button><label htmlFor="staff-workbook">Staff workbook (.xlsx)</label><input ref={fileInput} id="staff-workbook" type="file" accept=".xlsx" disabled={running || Boolean(draft)} onChange={(event) => void preview(event.target.files?.[0])} /></Flex>
    {previewing ? <Space style={{ marginTop: 12 }}><Typography.Text role="status">Validating workbook…</Typography.Text><Button onClick={clear}>Cancel validation</Button></Space> : null}
    {!draft && !previewing && error ? <Alert style={{ marginTop: 12 }} type="error" message={error} action={<Button onClick={() => void preview(fileInput.current?.files?.[0])}>Retry validation</Button>} /> : null}
    <Modal open={Boolean(draft)} title="Review staff import" width={900} destroyOnHidden maskClosable={false} closable={!running} keyboard={!running} onCancel={clear} footer={<Flex justify="space-between" gap={12} wrap><Button disabled={running} onClick={clear}>{started ? "Close import" : "Cancel import"}</Button><Space wrap>{running ? <Button onClick={() => { stop.current = true; setStopped(true); }}>Stop after current batch</Button> : <><Button type="primary" disabled={!draft?.validCount || Boolean(draft.invalidCount) || complete} onClick={() => void confirm()}>{started ? "Resume import" : "Confirm import"}</Button>{failed > 0 && complete ? <Button onClick={() => void confirm(true)}>Retry failed rows</Button> : null}</>}</Space></Flex>}>
      {draft ? <><Alert type={draft.invalidCount ? "error" : "info"} message={`${draft.validCount} valid rows · ${draft.invalidCount} invalid rows`} description={draft.invalidCount ? <><p>Fix all invalid rows and upload a new workbook before confirming.</p><ul>{draft.rows.filter((row) => row.errors.length > 0).map((row) => <li key={row.row}>Row {row.row}: {row.errors.join(" ")}</li>)}</ul></> : `Preview expires ${new Date(draft.expiresAt).toLocaleString()}. Confirmation creates permanent staff accounts.`} />
        <Table rowKey="row" pagination={{ pageSize: 10 }} scroll={{ x: 650 }} dataSource={[...draft.rows]} columns={[{ title: "Row", dataIndex: "row" }, { title: "Employee", key: "name", render: (_, row) => <span style={{ overflowWrap: "anywhere" }}>{row.input?.name ?? "—"}<br />{row.input?.email ?? "—"}</span> }, { title: "Role", key: "role", render: (_, row) => row.input?.role ?? "—" }, { title: "Branch", key: "branch", render: (_, row) => row.input?.branchCode ?? "—" }, { title: "Validation", key: "errors", render: (_, row) => row.errors.length ? row.errors.join(" ") : "Valid" }]} />
        {running ? <Typography.Paragraph role="status">Creating accounts in batches of up to 10… {results.length} row(s) processed.</Typography.Paragraph> : null}
        {stopped ? <Alert type="warning" message="Import stopped after the current batch. Completed accounts remain created." /> : null}
        {complete ? <Alert type={failed ? "warning" : "success"} message={`Import finished: ${results.length - failed} successful · ${failed} failed.`} /> : null}
        {error ? <Alert type="error" message={error} description="Completed accounts remain created. Resume uses the saved import and does not recreate successful rows." /> : null}
        {results.length ? <Table aria-label="Import results" rowKey="row" pagination={false} scroll={{ x: 500 }} dataSource={results} columns={[{ title: "Row", dataIndex: "row" }, { title: "Result", dataIndex: "status" }, { title: "Details", key: "error", render: (_, row) => row.error ?? "Account ready for onboarding" }]} /> : null}
      </> : null}
    </Modal>
    <StaffCredentialsModal credentials={running ? [] : credentials} onClose={() => setCredentials([])} />
  </Card>;
}
