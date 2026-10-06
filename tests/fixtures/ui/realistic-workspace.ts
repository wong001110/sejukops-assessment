import type { MockOrder, MockReview } from './workspace';
import { ids, ordersFixture, reviewFixture, settingsFixture } from './workspace';
import type { StaffAccountList } from '../../../src/domain/staff/contracts';
import type { AIObservationRecord } from '../../../src/domain/ai-observability/contracts';

// Deterministic, fictional Malaysian operations. Never loaded by the product server.
export const mockNow = new Date('2026-10-05T08:00:00.000Z');
export const mockId = (kind: number, n: number) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const realisticBranches = [
  { id: ids.branch, code: 'KL', name: 'Kuala Lumpur · Central' },
  { id: mockId(2, 2), code: 'PJ', name: 'Petaling Jaya · West' },
  { id: mockId(2, 3), code: 'SA', name: 'Shah Alam · Industrial' },
];
export const realisticCustomers = [
  ['Meranti Residence', '18 Jalan Meranti, Bangsar, Kuala Lumpur'],
  ['Kopi & Co. Café', '32 Jalan SS 2/75, Petaling Jaya'],
  ['Cedar Medical Centre', '8 Persiaran Anggerik, Shah Alam'],
  ['Lim Wei Ling', 'Unit 12-08, Taman Desa, Kuala Lumpur'],
  ['Nusantara Design Studio', '23 Jalan PJU 1A/4, Ara Damansara'],
  ['Amanah Learning Centre', '16 Jalan Tengku Ampuan Zabedah, Shah Alam'],
  ['Bayu Boutique Hotel', '41 Jalan Sultan Ismail, Kuala Lumpur'],
  ['Tan Jun Hao', 'Unit B-06-12, Kelana Jaya, Petaling Jaya'],
  ['Seri Murni Logistics', 'Lot 27, Seksyen 23, Shah Alam'],
  ['Orchid Dental Clinic', '12 Jalan Telawi 3, Bangsar, Kuala Lumpur'],
  ['Rimba Coworking', 'Level 3, Jalan Damansara, Petaling Jaya'],
  ['Siti Nur Aisyah', '22 Jalan U8/16, Bukit Jelutong, Shah Alam'],
].map(([name, address], i) => ({ id: mockId(3, i + 1), name, address }));
export const realisticTechnicians = ['Ahmad Hakim', 'Daniel Lim', 'Nur Farah', 'Arjun Kumar', 'Jason Wong', 'Mei Shan'].map((name, i) => ({ id: mockId(4, i + 1), name, branch_id: realisticBranches[i % 3].id, profile_id: mockId(9, i + 1) }));
const services = [
  ['Air conditioning inspection', 'Living-room 2.0 HP split unit runs but has weak airflow. Tenant reports the issue began after renovation; inspect the filter and coil before recommending parts.'],
  ['Preventive maintenance', 'Quarterly service for three wall-mounted units. Reception is open from 09:00; bring the maintenance checklist and confirm the outdoor-unit access key.'],
  ['Water leak repair', 'Water drips from the bedroom indoor unit after 40 minutes of operation. Check condensate drain, tray alignment and insulation; protect the parquet floor.'],
  ['Chemical cleaning', 'Restaurant ceiling cassette has reduced cooling during lunch service. Isolate the unit and schedule cleaning before 11:00; kitchen exhaust remains operational.'],
  ['Compressor diagnosis', 'Office unit trips the breaker on startup. Do not repeatedly reset the breaker. Record supply voltage and inspect electrical connections before testing.'],
  ['New unit installation', 'Install a customer-supplied 1.5 HP inverter unit in the study. Existing pipe route is approximately 6 metres; confirm bracket condition and drainage fall.'],
  ['Annual service', 'Service four guest-room units and document filter condition. Coordinate room access with the hotel supervisor; avoid occupied rooms until cleared.'],
  ['Cooling performance review', 'Meeting-room temperature remains above 26°C with six occupants. Compare return/supply temperatures and verify fan setting before proposing replacement.'],
];
export const realisticOrders: MockOrder[] = Array.from({ length: 48 }, (_, i) => {
  const statuses = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'ASSIGNED', 'COMPLETED', 'NEW'];
  const status = i === 6 ? "ASSIGNED" : statuses[i % statuses.length];
  const customer = realisticCustomers[i % realisticCustomers.length];
  const branch = realisticBranches[i % 3];
  const technician = realisticTechnicians[i % realisticTechnicians.length];
  const service = services[i % services.length];
  const updatedAt = new Date(mockNow.getTime() - (i + 1) * 1800000).toISOString();
  const scheduled = ['COMPLETED', 'CLOSED', 'IN_PROGRESS'].includes(status)
    ? new Date(Date.parse(updatedAt) - 5400000).toISOString()
    : new Date(mockNow.getTime() + ((i % 9) - 3) * 86400000 + ((i % 4) - 2) * 3600000).toISOString();
  return { ...ordersFixture[0], id: mockId(5, i + 1), order_no: `SJ-${branch.code}-2610-${String(i + 1).padStart(3, '0')}`,
    branch_id: branch.id, customer_id: customer.id, status, service_type: service[0],
    problem_description: `${customer.name} — ${service[1]} Site: ${customer.address}.`,
    scheduled_at: status === 'NEW' ? null : scheduled, assigned_technician_id: status === 'NEW' ? null : technician.id,
    updated_at: updatedAt };
});
export const realisticKnowledge: MockReview[] = [
  ['Split-unit filter inspection', 'Service handbook · Rev 3 / §2.1', 'Disconnect electrical power before opening the indoor unit. Inspect the return-air filter and photograph its condition. Wash reusable filters with clean water, dry fully, and verify airflow after reinstalling. Escalate a damaged coil or persistent restriction for technical review.'],
  ['Condensate leak diagnosis', 'Field SOP · Drainage / §4.2', 'Protect the floor before testing. Inspect the drain tray, clear the condensate line and verify continuous drainage fall. Run the unit for 20 minutes and observe the outlet. Record whether leakage occurs only during cooling or also while idle.'],
  ['Commercial-site access checklist', 'Operations handbook · Site access / §1.4', 'Confirm site contact, access window and parking before dispatch. Obtain the key or escort for outdoor-unit access. For clinics and food premises, agree on isolation areas and keep cleaning materials away from occupied spaces.'],
  ['Safe electrical fault assessment', 'Safety briefing · Electrical / §3.1', 'Do not repeatedly reset a tripping breaker. Isolate and verify the circuit before inspection. Record supply voltage, visible damage and error codes. Work on live electrical systems only within the technician’s qualification and approved procedure.'],
  ['Installation handover checklist', 'Quality checklist · Installation / §6.2', 'Verify bracket security, drainage fall, insulation and leak-test results. Document pipe length and installed model. Demonstrate basic controls to the customer and record commissioning temperatures before closing the visit.'],
  ['Cooling performance investigation', 'Technical guide · Diagnostics / §5.3', 'Record room occupancy, setpoint and ambient temperature. Compare return and supply readings after stable operation. Check filter, fan speed and outdoor airflow before inferring a refrigerant or compressor issue. Missing model information must be resolved before selecting parts.'],
].map(([title, sourceLabel, sourceText], i) => ({ ...reviewFixture, documentId: mockId(6, i + 1), versionId: mockId(7, i + 1), title, sourceLabel, sourceText, sourceKind: i % 2 ? 'PDF_TEXT' : 'TEXT' }));
export const realisticSettings = { ...settingsFixture, settings: { ...settingsFixture.settings, routingMode: 'TASK_BASED' as const },
  providers: [
    { ...settingsFixture.providers[0], name: 'Operations · Fast reasoning', model: 'ops-reasoner-v2', baseUrl: 'https://operations.models.example/v1', capabilities: { text: true, vision: false, toolCalling: true, structuredOutput: true } },
    { ...settingsFixture.providers[0], id: mockId(8, 2), name: 'Document · Vision extraction', model: 'document-vision-v3', baseUrl: 'https://documents.models.example/v1', capabilities: { text: true, vision: true, toolCalling: true, structuredOutput: true } },
    { ...settingsFixture.providers[0], id: mockId(8, 3), name: 'Legacy · Disabled fallback', model: 'archive-text-v1', baseUrl: 'https://archive.models.example/v1', status: 'DISABLED' as const },
  ], routes: { OPERATIONS_QUERY: ids.provider, WORKFLOW_EXPLANATION: ids.provider, OPERATIONAL_INSIGHT: ids.provider, DOCUMENT_UNDERSTANDING: mockId(8, 2) } };
export const realisticStaff: StaffAccountList = { branches: realisticBranches.map(({code, name}) => ({code, name})), accounts:
  ['Alicia Tan', 'Ravi Menon', ...realisticTechnicians.map(t => t.name), 'Sofia Rahman', 'Marcus Lee', 'Chong Wei', 'Hana Ibrahim'].map((name, i) => ({
    profileId: i >= 2 && i <= 7 ? realisticTechnicians[i-2].profile_id : mockId(9, i + 20), name, email: `${name.toLowerCase().replaceAll(' ', '.')}@sejuk-demo.example`,
    role: i === 0 || i === 8 ? 'ADMIN' : i === 1 || i > 8 ? 'MANAGER' : 'TECHNICIAN',
    branchCode: i >= 2 && i <= 7 ? realisticBranches[(i - 2) % 3].code : null,
    active: i !== 10, passwordChangeRequired: i === 7 || i === 11, authRevision: '2026-10-05T04:00:00.000Z',
  })) };
export const realisticObservations: AIObservationRecord[] = Array.from({ length: 28 }, (_, i) => ({
  id: mockId(9, i + 200), traceId: mockId(9, i + 300), createdAt: new Date(mockNow.getTime() - i * 420000).toISOString(),
  task: (['WORKSPACE_ORDERS', 'WORKSPACE_KNOWLEDGE', 'DOCUMENT_UNDERSTANDING', 'OPERATIONAL_INSIGHT', 'PROVIDER_TEST', 'OPERATIONS_QUERY', 'WORKFLOW_EXPLANATION'] as const)[i % 7],
  actorRole: (['ADMIN', 'MANAGER', 'SUPER_ADMIN'] as const)[i % 3], status: i % 11 === 10 ? 'FAILED' : i % 6 === 5 ? 'CONTROLLED' : 'SUCCEEDED',
  durationMs: i % 6 === 5 ? 42 : 840 + i * 113,
  execution: { flow: ['Read scoped service orders', 'Search published maintenance guidance', 'Extract service-request draft', 'Review weekly workload'][i % 4],
    outcome: i % 11 === 10 ? 'UNAVAILABLE' : i % 6 === 5 ? 'CLARIFICATION' : 'COMPLETE', providerSteps: i % 6 === 5 ? 0 : 2,
    inputTokens: i % 6 === 5 ? 0 : 1840 + i * 73, outputTokens: i % 6 === 5 ? 0 : 320 + i * 11, toolsCompleted: i % 6 === 5 ? 0 : 2, mode: 'mock' },
  providerCalls: [], errorCode: i % 11 === 10 ? 'PROVIDER_UNAVAILABLE' : null,
  safety: { rawPromptPersisted: false, rawProviderResponsePersisted: false, sanitizedDebugPayloadPersisted: false, credentialsPersisted: false, documentFieldValuesPersisted: false },
}));
