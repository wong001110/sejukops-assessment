"use client";

import { Alert, Button, Descriptions, Modal, Typography } from "antd";
import type { StaffCredential } from "@/domain/staff/contracts";

export function StaffCredentialsModal({ credentials, onClose }: { credentials: readonly StaffCredential[]; onClose: () => void }) {
  return <Modal open={credentials.length > 0} title="Temporary login credentials" destroyOnHidden maskClosable={false} keyboard={false} onCancel={onClose} footer={<Button type="primary" onClick={onClose}>Close and clear passwords</Button>}>
    {credentials.length ? <><Alert type="warning" message="Share privately now. Closing clears these passwords from this screen." description="Employees must change their password at their next sign-in. Passwords cannot be retrieved later." />{credentials.map((credential) => <Descriptions key={credential.email} column={1} style={{ marginTop: 16 }} items={[{ key: "email", label: "Employee email", children: credential.email }, { key: "password", label: "Temporary password", children: <Typography.Text code style={{ overflowWrap: "anywhere" }}>{credential.password}</Typography.Text> }]} />)}</> : null}
  </Modal>;
}
