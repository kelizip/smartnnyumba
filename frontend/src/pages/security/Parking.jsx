import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import AppLayout  from '../../components/layout/AppLayout';
import Modal      from '../../components/ui/Modal';
import Input      from '../../components/ui/Input';
import Select     from '../../components/ui/Select';
import { Table }  from '../../components/ui/Table';
import Badge      from '../../components/ui/Badge';
import { useAuth } from '../../context/AuthContext';
import api, { getParkingSlots, assignSlot, updateSlotStatus, getUnits } from '../../api';

export default function SecurityParking() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [assignModal, setAssignModal] = useState(null);
  const [assignForm,  setAssignForm]  = useState({ unit_id:'', vehicle_plate:'', tenant_name:'' });
  const [busy, setBusy] = useState(false);

  const { data: slots, isLoading } = useQuery({
    queryKey: ['parking-slots', user?.property_id],
    queryFn: () => getParkingSlots().then(r => r.data.slots),
  });

  const { data: units } = useQuery({
    queryKey: ['units-occupied', user?.property_id],
    queryFn: () => getUnits({ status: 'occupied', property_id: user?.property_id || undefined }).then(r => r.data.units),
  });

  // Filter to security guard's assigned property
  const mySlots = (slots||[]).filter(s =>
    !user?.property_id || String(s.property_id) === String(user.property_id)
  );

  const unitOpts = (units||[]).map(u => ({
    value: u.id,
    label: `Unit ${u.unit_number}${u.tenant_name ? ' — ' + u.tenant_name : ''}`,
  }));

  const doAssign = async () => {
    if (!assignForm.vehicle_plate) return toast.error('Vehicle plate required');
    setBusy(true);
    try {
      await assignSlot(assignModal.id, assignForm);
      toast.success('Slot assigned!');
      qc.invalidateQueries(['parking-slots']);
      setAssignModal(null);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  };

  const doUpdateStatus = async (id, status) => {
    try {
      await updateSlotStatus(id, { status });
      toast.success('Status updated');
      qc.invalidateQueries(['parking-slots']);
    } catch { toast.error('Failed'); }
  };

  const available = mySlots.filter(s => s.status === 'available').length;
  const occupied  = mySlots.filter(s => s.status === 'occupied').length;

  const cols = [
    { label: 'Slot',     render: r => <span className="font-bold text-lg">{r.slot_number}</span> },
    { label: 'Type',     render: r => <span className="capitalize text-sm text-[--text-muted]">{r.type}</span> },
    { label: 'Status',   render: r => <Badge status={r.status} label={r.status} /> },
    { label: 'Tenant',   render: r => r.tenant_name || <span className="text-[--text-muted]">—</span> },
    { label: 'Vehicle',  render: r => r.vehicle_plate
        ? <span className="font-mono text-sm bg-[--surface-muted] px-2 py-1 rounded">{r.vehicle_plate}</span>
        : '—' },
    { label: '', render: r => (
      <div className="flex gap-1">
        {r.status === 'available' && (
          <button className="btn-primary btn-sm" onClick={e => { e.stopPropagation(); setAssignModal(r); setAssignForm({ unit_id:'', vehicle_plate:'', tenant_name:'' }); }}>
            Assign
          </button>
        )}
        {r.status === 'occupied' && (
          <button className="btn-danger btn-sm" onClick={e => { e.stopPropagation(); doUpdateStatus(r.id, 'available'); }}>
            Vacate
          </button>
        )}
      </div>
    )},
  ];

  return (
    <AppLayout title="Parking">
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card card-body text-center">
          <p className="text-3xl font-bold text-[--brand]">{mySlots.length}</p>
          <p className="text-xs text-[--text-muted] mt-1">Total slots</p>
        </div>
        <div className="card card-body text-center">
          <p className="text-3xl font-bold text-[--green]">{available}</p>
          <p className="text-xs text-[--text-muted] mt-1">Available</p>
        </div>
        <div className="card card-body text-center">
          <p className="text-3xl font-bold text-[--text-secondary]">{occupied}</p>
          <p className="text-xs text-[--text-muted] mt-1">Occupied</p>
        </div>
      </div>

      {user?.property_id && (
        <div className="alert-info text-xs mb-4">📍 Showing slots for your assigned property only.</div>
      )}

      <div style={{background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",padding:"1.25rem"}}>
        <Table columns={cols} data={mySlots} loading={isLoading} emptyMsg="No parking slots found" />
        </div>

      <Modal open={!!assignModal} onClose={() => setAssignModal(null)} title={`Assign slot ${assignModal?.slot_number}`} size="sm">
        <div className="p-5 flex flex-col gap-3">
          <Select label="Unit (optional)" value={assignForm.unit_id}
            onChange={v => {
              const unit = (units||[]).find(u => String(u.id) === String(v));
              setAssignForm(f => ({ ...f, unit_id: v, tenant_name: unit?.tenant_name || f.tenant_name }));
            }}
            options={unitOpts} placeholder="Select unit..." />
          <Input label="Tenant name"   value={assignForm.tenant_name}   onChange={e => setAssignForm(f=>({...f,tenant_name:e.target.value}))} />
          <Input label="Vehicle plate *" value={assignForm.vehicle_plate} onChange={e => setAssignForm(f=>({...f,vehicle_plate:e.target.value.toUpperCase()}))} placeholder="KXX 000A" />
        </div>
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button className="btn-secondary" onClick={() => setAssignModal(null)}>Cancel</button>
          <button className="btn-primary" onClick={doAssign} disabled={busy}>{busy ? 'Assigning...' : 'Assign slot'}</button>
        </div>
      </Modal>
    </AppLayout>
  );
}
