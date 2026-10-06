import { describe, expect, it } from 'vitest';
import { realisticOrders, realisticTechnicians, realisticStaff, realisticBranches, realisticCustomers, realisticKnowledge, realisticObservations } from '../fixtures/ui/realistic-workspace';
import { aiObservationRecordSchema } from '../../src/domain/ai-observability/contracts';

describe('realistic local UI fixtures', () => {
  it('keeps every order connected to an existing customer, branch and same-branch technician', () => {
    expect(realisticOrders).toHaveLength(48);
    expect(new Set(realisticOrders.map(order=>order.id)).size).toBe(48);
    for(const order of realisticOrders) {
      expect(realisticBranches.some(branch=>branch.id===order.branch_id)).toBe(true);
      expect(realisticCustomers.some(customer=>customer.id===order.customer_id)).toBe(true);
      if(order.assigned_technician_id) expect(realisticTechnicians.find(tech=>tech.id===order.assigned_technician_id)?.branch_id).toBe(order.branch_id);
      if(['COMPLETED','CLOSED','IN_PROGRESS'].includes(order.status)) expect(Date.parse(order.scheduled_at!)).toBeLessThan(Date.parse(order.updated_at));
      if(order.status==='NEW') { expect(order.assigned_technician_id).toBeNull(); expect(order.scheduled_at).toBeNull(); }
    }
  });
  it('uses the same employee identities for technician records and staff management', () => {
    for(const technician of realisticTechnicians) {
      const staff=realisticStaff.accounts.find(account=>account.profileId===technician.profile_id);
      expect(staff?.name).toBe(technician.name);
      expect(staff?.role).toBe('TECHNICIAN');
      expect(staff?.branchCode).toBe(realisticBranches.find(branch=>branch.id===technician.branch_id)?.code);
    }
  });
  it('keeps knowledge identifiers distinct and diagnostic records within the real API contract', () => {
    expect(new Set(realisticKnowledge.map(review=>review.versionId)).size).toBe(6);
    for(const record of realisticObservations) expect(aiObservationRecordSchema.safeParse(record).success).toBe(true);
    expect(realisticObservations.some(record=>record.status==='FAILED')).toBe(true);
    expect(realisticObservations.some(record=>record.status==='CONTROLLED')).toBe(true);
  });
});
