"use client";

import { ApiOutlined, CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Descriptions, Empty, Flex, Form, Input, List, Modal, Popconfirm, Radio, Result, Row, Select, Skeleton, Space, Switch, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { missingCapabilitiesForTask, normalizeSafeAIBaseUrl } from "@/domain/ai-config/contracts";
import { AI_TASKS, AISettingsApiError, aiSettingsApi, type AIModelCapabilities, type AISettingsSnapshot, type AITaskType, type ProviderInput, type RoutingMode, type SafeFallback, type SafeProfile } from "./ai-settings-api";
import { capabilityLabels, isCompatible, missingCapabilities, missingImageDocumentCapabilities, routingProblems, taskLabels } from "./compatibility";

type ProviderFormValues = ProviderInput & { apiKey?: string };
type Feedback = { kind: "success" | "error" | "warning"; message: string };
const emptyRoutes = Object.fromEntries(AI_TASKS.map((task) => [task, null])) as Record<AITaskType, string | null>;
const defaultCapabilities: AIModelCapabilities = { text: true, vision: false, toolCalling: false, structuredOutput: true };

export function AISettingsWorkspace() {
  const [snapshot, setSnapshot] = useState<AISettingsSnapshot>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SafeProfile>();
  const [savingProvider, setSavingProvider] = useState(false);
  const [testing, setTesting] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingMode, setRoutingMode] = useState<RoutingMode>("SINGLE_MODEL");
  const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Record<AITaskType, string | null>>(emptyRoutes);
  const [form] = Form.useForm<ProviderFormValues>();
  const createRequestKey = useRef<string>();

  const adopt = useCallback((next: AISettingsSnapshot) => {
    setSnapshot(next);
    setRoutingMode(next.settings.routingMode);
    setDefaultProviderId(next.settings.defaultProviderConfigId);
    setRoutes({ ...emptyRoutes, ...next.routes });
  }, []);
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(undefined);
    try { adopt(await aiSettingsApi.get()); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : "AI settings could not be loaded."); }
    finally { if (!quiet) setLoading(false); }
  }, [adopt]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { form.setFieldValue("apiKey", ""); }, [form]);

  const closeEditor = () => {
    form.setFieldValue("apiKey", "");
    createRequestKey.current = undefined;
    setEditorOpen(false);
    setEditing(undefined);
  };
  const openCreate = () => {
    setEditing(undefined); setFeedback(undefined);
    createRequestKey.current = crypto.randomUUID();
    form.setFieldsValue({ name: "", providerType: "OPENAI_COMPATIBLE", baseUrl: "", model: "", status: "ACTIVE", apiKey: "", capabilities: defaultCapabilities });
    setEditorOpen(true);
  };
  const openEdit = (profile: SafeProfile) => {
    setEditing(profile); setFeedback(undefined);
    createRequestKey.current = undefined;
    form.setFieldsValue({ name: profile.name, providerType: profile.providerType, baseUrl: profile.baseUrl, model: profile.model, status: profile.status, apiKey: "", capabilities: profile.capabilities });
    setEditorOpen(true);
  };
  const providerInput = (values: ProviderFormValues): ProviderInput => ({ name: values.name.trim(), providerType: "OPENAI_COMPATIBLE", baseUrl: values.baseUrl.trim(), model: values.model.trim(), status: values.status, capabilities: values.capabilities, ...(values.apiKey?.trim() ? { apiKey: values.apiKey.trim() } : {}) });
  const applyFieldErrors = (cause: unknown) => {
    if (!(cause instanceof AISettingsApiError) || !cause.fieldErrors) return false;
    const topLevelFields = { name: "name", providerType: "providerType", baseUrl: "baseUrl", model: "model", capabilities: "capabilities", status: "status", apiKey: "apiKey" } as const;
    const capabilityFields = { text: "text", vision: "vision", toolCalling: "toolCalling", structuredOutput: "structuredOutput" } as const;
    const fields: Parameters<typeof form.setFields>[0] = [];
    for (const [name, errors] of Object.entries(cause.fieldErrors)) {
      const [topLevel, nested] = name.split(".");
      const messages = Array.isArray(errors) ? errors : [errors];
      const capability = capabilityFields[nested as keyof typeof capabilityFields];
      if (topLevel === "capabilities" && capability) { fields.push({ name: ["capabilities", capability], errors: messages }); continue; }
      const field = topLevelFields[topLevel as keyof typeof topLevelFields];
      if (field) fields.push({ name: [field], errors: messages });
    }
    if (!fields.length) return false;
    form.setFields(fields);
    return true;
  };
  const saveProvider = async () => {
    try {
      const values = await form.validateFields();
      if (!editing && !values.apiKey?.trim()) { form.setFields([{ name: "apiKey", errors: ["API key is required for a new provider."] }]); return; }
      setSavingProvider(true); setFeedback(undefined);
      const input = providerInput(values);
      if (editing) await aiSettingsApi.updateProvider(editing.id, input);
      else { const requestKey = createRequestKey.current ?? crypto.randomUUID(); createRequestKey.current = requestKey; await aiSettingsApi.createProvider({ ...input, apiKey: values.apiKey!.trim(), requestKey }); }
      form.setFieldValue("apiKey", ""); closeEditor();
      await load(true);
      setFeedback({ kind: "success", message: `${values.name.trim()} was ${editing ? "updated" : "added"}. The plaintext credential was cleared from this form.` });
    } catch (cause) {
      if (!applyFieldErrors(cause) && cause instanceof Error) setFeedback({ kind: "error", message: cause.message });
    } finally { setSavingProvider(false); }
  };
  const testForm = async () => {
    try {
      const values = await form.validateFields();
      if (!editing && !values.apiKey?.trim()) { form.setFields([{ name: "apiKey", errors: ["Enter an API key to test this unsaved provider."] }]); return; }
      setTesting(editing?.id ?? "NEW"); setFeedback(undefined);
      if (editing) await aiSettingsApi.testSavedProvider(editing.id, values.apiKey?.trim() || undefined);
      else await aiSettingsApi.testUnsavedProvider({ ...providerInput(values), apiKey: values.apiKey!.trim() });
      setFeedback({ kind: "success", message: `Connection test passed for ${values.name.trim()}. No credential was returned to the browser.` });
    } catch (cause) {
      if (!applyFieldErrors(cause)) setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : "Connection test failed safely. Verify the provider settings and retry." });
    } finally { setTesting(undefined); }
  };
  const testSaved = async (profile: SafeProfile) => {
    setTesting(profile.id); setFeedback(undefined);
    try { await aiSettingsApi.testSavedProvider(profile.id); setFeedback({ kind: "success", message: `${profile.name} responded successfully.` }); }
    catch (cause) { setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : "Connection test failed safely. Verify the saved profile and retry." }); }
    finally { setTesting(undefined); }
  };
  const deleteProvider = async (profile: SafeProfile) => {
    setDeleting(profile.id); setFeedback(undefined);
    try { await aiSettingsApi.deleteProvider(profile.id); await load(true); setFeedback({ kind: "success", message: `${profile.name} was removed.` }); }
    catch (cause) { setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : "Provider could not be removed. Check routing and retry." }); }
    finally { setDeleting(undefined); }
  };

  const problems = useMemo(() => routingProblems(snapshot?.providers ?? [], routingMode, defaultProviderId, routes), [snapshot?.providers, routingMode, defaultProviderId, routes]);
  const hasBlankRoute = routingMode === "SINGLE_MODEL" ? !defaultProviderId : AI_TASKS.some((task) => !routes[task]);
  const saveRouting = async () => {
    if (problems.length) { setFeedback({ kind: "warning", message: "Resolve the capability and route issues before saving routing." }); return; }
    setRoutingSaving(true); setFeedback(undefined);
    try { const input = routingMode === "SINGLE_MODEL" ? { routingMode, defaultProviderConfigId: defaultProviderId } as const : { routingMode, routes } as const; const next = await aiSettingsApi.updateRouting(input); adopt(next); setFeedback({ kind: "success", message: "AI routing was saved atomically. SejukOps will not silently switch providers after a failure." }); }
    catch (cause) { setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : "Routing could not be saved. Review the selections and retry." }); }
    finally { setRoutingSaving(false); }
  };

  if (loading) return <Space direction="vertical" size={18} className="ai-settings-page"><Skeleton active paragraph={{ rows: 2 }} /><Row gutter={[16, 16]}>{[1, 2].map((item) => <Col xs={24} xl={12} key={item}><Card><Skeleton active paragraph={{ rows: 5 }} /></Card></Col>)}</Row></Space>;
  if (loadError || !snapshot) return <Result status="error" title="AI settings could not be loaded" subTitle={loadError} extra={<Button type="primary" icon={<ReloadOutlined />} onClick={() => void load()}>Retry</Button>} />;

  return <Space direction="vertical" size={20} className="ai-settings-page">
    <Flex justify="space-between" align="flex-start" gap={16} wrap><div><Typography.Title level={2}>AI Settings</Typography.Title><Typography.Paragraph type="secondary">Configure encrypted provider credentials and explicit capability-aware routing.</Typography.Paragraph></div><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add provider</Button></Flex>
    {feedback ? <Alert type={feedback.kind} showIcon closable onClose={() => setFeedback(undefined)} message={feedback.message} /> : null}
    <Alert type="info" showIcon message="Provider calls stay server-side" description="Only masked credential metadata is displayed. A blank API key while editing preserves the saved encrypted credential." />

    <Card title="Configured providers" extra={<Typography.Text type="secondary">{snapshot.providers.length} profile(s)</Typography.Text>}>
      {!snapshot.providers.length ? <Empty description="No saved AI providers"><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add the first provider</Button></Empty> : <List grid={{ gutter: 16, xs: 1, md: 1, xl: 2 }} dataSource={[...snapshot.providers]} renderItem={(profile) => <List.Item><ProviderCard profile={profile} testing={testing === profile.id} deleting={deleting === profile.id} onEdit={() => openEdit(profile)} onTest={() => void testSaved(profile)} onDelete={() => void deleteProvider(profile)} /></List.Item>} />}
    </Card>

    <Card title="Routing mode" className="ai-routing-card">
      <Radio.Group value={routingMode} onChange={(event) => setRoutingMode(event.target.value as RoutingMode)} optionType="button" buttonStyle="solid" disabled={routingSaving}><Radio.Button value="SINGLE_MODEL">Single Model</Radio.Button><Radio.Button value="TASK_BASED">Task-based Routing</Radio.Button></Radio.Group>
      <Typography.Paragraph type="secondary" className="ai-routing-copy">{routingMode === "SINGLE_MODEL" ? "One active provider handles every compatible AI task. Image document understanding requires Vision." : "Select an explicit provider for each task. Failures never trigger an unconfigured paid fallback."}</Typography.Paragraph>
      {routingMode === "SINGLE_MODEL" ? <SingleModelRouting providers={snapshot.providers} value={defaultProviderId} onChange={setDefaultProviderId} /> : <TaskRouting providers={snapshot.providers} routes={routes} onChange={(task, providerId) => setRoutes((current) => ({ ...current, [task]: providerId }))} />}
      <CompatibilityMatrix providers={snapshot.providers} environmentFallbacks={snapshot.environmentFallbacks} mode={routingMode} defaultId={defaultProviderId} routes={routes} />
      {problems.length ? <Alert type="warning" showIcon message="Routing needs attention" description={<ul className="ai-problem-list">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>} /> : hasBlankRoute ? <Alert type="info" showIcon message="Explicit environment fallback / Not Configured route" description="Blank selections use only a complete configured deployment fallback; otherwise that task reports Not Configured. Runtime provider failures never trigger another provider." /> : <Alert type="success" showIcon message="Every selected provider is active and compatible." />}
      <Flex justify="flex-end"><Button type="primary" loading={routingSaving} disabled={routingSaving || Boolean(problems.length)} onClick={() => void saveRouting()}>Save routing</Button></Flex>
    </Card>

    <EnvironmentFallbacks items={snapshot.environmentFallbacks} />
    <ProviderEditor open={editorOpen} editing={editing} form={form} saving={savingProvider} testing={testing === (editing?.id ?? "NEW")} onCancel={closeEditor} onSave={() => void saveProvider()} onTest={() => void testForm()} />
  </Space>;
}

function ProviderCard({ profile, testing, deleting, onEdit, onTest, onDelete }: { profile: SafeProfile; testing: boolean; deleting: boolean; onEdit: () => void; onTest: () => void; onDelete: () => void }) {
  const statusType = profile.status === "ACTIVE" ? "success" : profile.status === "INVALID" ? "error" : "default";
  return <Card className="ai-provider-card" title={<Space><ApiOutlined /><span>{profile.name}</span></Space>} extra={<Tag color={statusType}>{profile.status}</Tag>}>
    <Descriptions column={1} size="small" items={[{ key: "model", label: "Model", children: profile.model }, { key: "url", label: "Base URL", children: profile.baseUrl }, { key: "credential", label: "Credential", children: profile.credential.configured ? <Typography.Text code>{profile.credential.last4 ? `••••${profile.credential.last4}` : "Saved credential"}</Typography.Text> : <Tag color="warning">Not configured</Tag> }]} />
    <div className="ai-capabilities"><CapabilityTags capabilities={profile.capabilities} /></div>
    <Flex gap={8} wrap><Button icon={<EditOutlined />} onClick={onEdit}>Edit</Button><Button icon={<ApiOutlined />} loading={testing} onClick={onTest} disabled={deleting}>Test</Button><Popconfirm title="Remove this provider?" description="Removal also clears any default or task routes that reference this provider." okText="Remove" okButtonProps={{ danger: true, loading: deleting }} onConfirm={onDelete}><Button danger icon={<DeleteOutlined />} disabled={testing}>Remove</Button></Popconfirm></Flex>
  </Card>;
}

function CapabilityTags({ capabilities }: { capabilities: AIModelCapabilities }) { return <Space size={[4, 6]} wrap>{(Object.keys(capabilityLabels) as Array<keyof AIModelCapabilities>).map((key) => <Tag key={key} color={capabilities[key] ? "blue" : "default"}>{capabilities[key] ? <CheckCircleOutlined /> : <CloseCircleOutlined />} {capabilityLabels[key]}</Tag>)}</Space>; }

function ProviderEditor({ open, editing, form, saving, testing, onCancel, onSave, onTest }: { open: boolean; editing?: SafeProfile; form: ReturnType<typeof Form.useForm<ProviderFormValues>>[0]; saving: boolean; testing: boolean; onCancel: () => void; onSave: () => void; onTest: () => void }) {
  return <Modal open={open} title={editing ? `Edit ${editing.name}` : "Add AI provider"} width={720} destroyOnHidden maskClosable={false} onCancel={onCancel} afterClose={() => form.resetFields()} footer={<Flex justify="space-between" gap={8} wrap><Button icon={<ApiOutlined />} loading={testing} disabled={saving} onClick={onTest}>{editing ? "Test saved profile" : "Test connection"}</Button><Space><Button onClick={onCancel}>Cancel</Button><Button type="primary" loading={saving} disabled={testing} onClick={onSave}>{editing ? "Save changes" : "Add provider"}</Button></Space></Flex>}>
    <Form form={form} layout="vertical" requiredMark="optional" preserve={false} className="ai-provider-form">
      <Row gutter={16}><Col xs={24} md={12}><Form.Item name="name" label="Profile name" rules={[{ required: true, whitespace: true, message: "Enter a profile name." }, { max: 100 }]}><Input autoComplete="off" placeholder="Operations model" /></Form.Item></Col><Col xs={24} md={12}><Form.Item name="providerType" label="Provider adapter"><Select disabled options={[{ label: "OpenAI-compatible", value: "OPENAI_COMPATIBLE" }]} /></Form.Item></Col></Row>
      <Row gutter={16}><Col xs={24} md={12}><Form.Item name="baseUrl" label="Base URL" extra="Required public HTTPS endpoint; credentials, query strings, and private/local hosts are blocked." rules={[{ required: true, whitespace: true, message: "Enter the provider API base URL." }, { validator: async (_, value: string) => { if (!value) return; try { normalizeSafeAIBaseUrl(value); } catch { throw new Error("Use a public HTTPS provider URL without credentials, query parameters, or fragments."); } } }]}><Input autoComplete="off" placeholder="https://api.provider.example/v1" /></Form.Item></Col><Col xs={24} md={12}><Form.Item name="model" label="Model" rules={[{ required: true, whitespace: true, message: "Enter the provider model identifier." }, { max: 200 }]}><Input autoComplete="off" placeholder="model-name" /></Form.Item></Col></Row>
      <Row gutter={16}><Col xs={24} md={16}><Form.Item name="apiKey" label="API key" extra={editing ? "Leave blank to preserve the encrypted saved key. The plaintext value is cleared when this dialog closes." : "Sent only to the Admin server endpoint; never returned after save."}><Input.Password autoComplete="new-password" placeholder={editing ? "Leave blank to preserve saved key" : "Enter provider API key"} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="status" label="Status"><Select options={[{ label: "Active", value: "ACTIVE" }, { label: "Disabled", value: "DISABLED" }, { label: "Invalid (test/update to recover)", value: "INVALID", disabled: true }]} /></Form.Item></Col></Row>
      <Typography.Title level={5}>Declared capabilities</Typography.Title><Typography.Paragraph type="secondary">Declare only capabilities supported by this model and adapter. Routing validates these before save.</Typography.Paragraph>
      <Row gutter={[12, 4]}>{(Object.keys(capabilityLabels) as Array<keyof AIModelCapabilities>).map((key) => <Col xs={24} sm={12} key={key}><Form.Item name={["capabilities", key]} valuePropName="checked" label={capabilityLabels[key]}><Switch checkedChildren="Supported" unCheckedChildren="Not supported" /></Form.Item></Col>)}</Row>
      {editing ? <Alert type="info" showIcon message="Testing here uses the saved profile metadata" description="Save changed URL, model, or capabilities before testing those changes. A newly entered API key can be tested without saving it." /> : null}
    </Form>
  </Modal>;
}

function providerOptions(providers: readonly SafeProfile[]) { return providers.map((profile) => ({ label: `${profile.name} · ${profile.model}${profile.status !== "ACTIVE" ? ` · ${profile.status}` : ""}`, value: profile.id, disabled: profile.status !== "ACTIVE" })); }
function SingleModelRouting({ providers, value, onChange }: { providers: readonly SafeProfile[]; value: string | null; onChange: (value: string | null) => void }) { return <div className="ai-routing-select"><Typography.Text strong>Default AI model</Typography.Text><Select showSearch optionFilterProp="label" placeholder="Environment fallback / Not configured" options={providerOptions(providers)} value={value} onChange={onChange} allowClear /></div>; }
function TaskRouting({ providers, routes, onChange }: { providers: readonly SafeProfile[]; routes: Record<AITaskType, string | null>; onChange: (task: AITaskType, value: string | null) => void }) { return <div className="ai-task-routing">{AI_TASKS.map((task) => <div className="ai-task-route" key={task}><div><Typography.Text strong>{taskLabels[task]}</Typography.Text><Typography.Text type="secondary">{task === "DOCUMENT_UNDERSTANDING" ? "Image/scanned input requires Vision and structured output." : "Uses the explicitly selected provider only."}</Typography.Text></div><Select showSearch optionFilterProp="label" placeholder="Environment fallback / Not configured" options={providerOptions(providers)} value={routes[task]} onChange={(value) => onChange(task, value)} allowClear /></div>)}</div>; }

function CompatibilityMatrix({ providers, environmentFallbacks, mode, defaultId, routes }: { providers: readonly SafeProfile[]; environmentFallbacks: readonly SafeFallback[]; mode: RoutingMode; defaultId: string | null; routes: Record<AITaskType, string | null> }) {
  const byId = new Map(providers.map((profile) => [profile.id, profile]));
  const documentSelectedId = mode === "SINGLE_MODEL" ? defaultId : routes.DOCUMENT_UNDERSTANDING;
  const documentProfile = byId.get(documentSelectedId ?? "");
  const documentFallback = !documentSelectedId ? environmentFallbacks.find((item) => item.configured && item.tasks.includes("DOCUMENT_UNDERSTANDING")) : undefined;
  const imageMissing = documentProfile ? missingImageDocumentCapabilities(documentProfile) : documentFallback ? missingCapabilitiesForTask(documentFallback.capabilities, "DOCUMENT_UNDERSTANDING", "IMAGE") : ["vision"] as const;
  const imageReady = Boolean((documentProfile || documentFallback) && !imageMissing.length);
  return <div className="ai-compatibility"><Typography.Title level={5}>Compatibility</Typography.Title><List size="small" dataSource={[...AI_TASKS]} renderItem={(task) => { const selectedId = mode === "SINGLE_MODEL" ? defaultId : routes[task]; const profile = byId.get(selectedId ?? ""); const fallback = !selectedId ? environmentFallbacks.find((item) => item.configured && item.tasks.includes(task)) : undefined; const fallbackMissing = fallback ? missingCapabilitiesForTask(fallback.capabilities, task, "TEXT") : []; const missing = profile ? missingCapabilities(profile, task) : fallbackMissing; const compatible = profile ? isCompatible(profile, task) : Boolean(fallback && !fallbackMissing.length); const unconfigured = !profile && !fallback; const description = profile ? `${profile.name} · ${profile.model}${missing.length ? ` · Missing ${missing.map((key) => capabilityLabels[key]).join(", ")}` : ""}` : fallback ? `Environment: ${fallback.name} · ${fallback.model}${missing.length ? ` · Missing ${missing.map((key) => capabilityLabels[key]).join(", ")}` : ""}` : "No saved or configured environment provider"; return <List.Item className={compatible ? "is-compatible" : unconfigured ? "is-unconfigured" : "is-incompatible"} extra={<Tag color={compatible ? "success" : unconfigured ? "default" : "warning"}>{compatible ? "Compatible" : unconfigured ? "Not configured" : "Capability mismatch"}</Tag>}><List.Item.Meta avatar={compatible ? <CheckCircleOutlined /> : <CloseCircleOutlined />} title={taskLabels[task]} description={description} /></List.Item>; }} /><List.Item className={imageReady ? "is-compatible" : "is-incompatible"} extra={<Tag color={imageReady ? "success" : "warning"}>{imageReady ? "Image ready" : "Vision required"}</Tag>}><List.Item.Meta avatar={imageReady ? <CheckCircleOutlined /> : <CloseCircleOutlined />} title="Image / scanned Document Understanding" description={imageReady ? "Text and image/scanned documents are compatible with the selected route." : "Text documents remain compatible when base requirements pass; image/scanned inputs are blocked until a Vision provider is selected."} /></List.Item></div>;
}

function EnvironmentFallbacks({ items }: { items: readonly SafeFallback[] }) {
  if (!items.length) return <Card title="Deployment environment fallbacks"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No safe environment fallback metadata is available." /></Card>;
  return <Card title="Deployment environment fallbacks" extra={<Tag icon={<SafetyCertificateOutlined />}>Read-only</Tag>}><Alert type="warning" showIcon message="Saved Admin routing takes precedence" description="An environment profile is used only when that task has no saved provider selection (a blank route/default), never after a selected provider fails. There is no silent runtime failover." /><List dataSource={[...items]} renderItem={(item) => <List.Item><List.Item.Meta avatar={<SafetyCertificateOutlined />} title={item.name} description={<Space direction="vertical" size={2}><span>{item.model} · {item.baseUrl}</span><span>{item.tasks.map((task) => taskLabels[task]).join(" · ")}</span></Space>} /><Tag color={item.configured ? "success" : "default"}>{item.configured ? "Configured" : "Unavailable"}</Tag></List.Item>} /></Card>;
}
